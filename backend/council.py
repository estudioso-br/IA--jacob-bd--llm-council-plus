"""3-stage LLM Council orchestration."""

from typing import List, Dict, Any, Tuple
import asyncio
from . import openrouter
from . import ollama_client
from .config import get_council_models, get_chairman_model, get_llm_provider
from .search import perform_web_search, SearchProvider
from .settings import get_settings


async def query_model(model: str, messages: List[Dict[str, str]], timeout: float = 120.0) -> Dict[str, Any]:
    """Dispatch query to appropriate provider."""
    provider = get_llm_provider()
    
    if provider == "hybrid":
        if model.startswith("ollama:"):
            return await ollama_client.query_model(model.removeprefix("ollama:"), messages, timeout)
        else:
            return await openrouter.query_model(model, messages, timeout)
            
    if provider == "ollama":
        # Ensure we strip the prefix if it exists (e.g. from a utility model setting)
        clean_model = model.removeprefix("ollama:")
        return await ollama_client.query_model(clean_model, messages, timeout)
    return await openrouter.query_model(model, messages, timeout)


async def query_models_parallel(models: List[str], messages: List[Dict[str, str]]) -> Dict[str, Any]:
    """Dispatch parallel query to appropriate provider."""
    provider = get_llm_provider()
    
    if provider == "hybrid":
        # Group models by provider
        ollama_models = []
        openrouter_models = []
        
        for model in models:
            if model.startswith("ollama:"):
                ollama_models.append(model)
            else:
                openrouter_models.append(model)
        
        tasks = []
        # Create tasks for Ollama models
        if ollama_models:
            # Strip prefix for the actual call, but map back to full ID in result
            tasks.append(_query_ollama_batch(ollama_models, messages))
            
        # Create task for OpenRouter models (it handles its own parallelism)
        if openrouter_models:
             tasks.append(openrouter.query_models_parallel(openrouter_models, messages))
             
        # Execute
        results = await asyncio.gather(*tasks)
        
        # Merge results
        combined_results = {}
        for result_batch in results:
            combined_results.update(result_batch)
            
        return combined_results

    if provider == "ollama":
        return await ollama_client.query_models_parallel(models, messages)
    return await openrouter.query_models_parallel(models, messages)


async def _query_ollama_batch(prefixed_models: List[str], messages: List[Dict[str, str]]) -> Dict[str, Any]:
    """Helper to query a batch of Ollama models and restore prefixes."""
    raw_models = [m.removeprefix("ollama:") for m in prefixed_models]
    results = await ollama_client.query_models_parallel(raw_models, messages)
    # Remap back to prefixed keys
    return {f"ollama:{model}": result for model, result in results.items()}


async def stage1_collect_responses(user_query: str, search_context: str = "") -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question
        search_context: Optional web search results to provide context

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    if search_context:
        prompt = f"""You have access to the following real-time web search results.
You MUST use this information to answer the question, even if it contradicts your internal knowledge cutoff.
Do not say "I cannot access real-time information" or "My knowledge is limited to..." because you have the search results right here.

Search Results:
{search_context}

Question: {user_query}"""
    else:
        prompt = user_query

    messages = [{"role": "user", "content": prompt}]

    # Query all models in parallel
    responses = await query_models_parallel(get_council_models(), messages)

    # Format results - include both successful and failed responses
    stage1_results = []
    for model, response in responses.items():
        if response is not None:
            if response.get('error'):
                # Include failed models with error info
                stage1_results.append({
                    "model": model,
                    "response": None,
                    "error": response.get('error'),
                    "error_message": response.get('error_message', 'Unknown error')
                })
            else:
                # Successful response
                stage1_results.append({
                    "model": model,
                    "response": response.get('content', ''),
                    "error": None
                })

    return stage1_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    search_context: str = ""
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1
        search_context: Optional web search results for fact-checking

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    settings = get_settings()

    # Filter to only successful responses for ranking
    successful_results = [r for r in stage1_results if not r.get('error')]

    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(successful_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, successful_results)
    }

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, successful_results)
    ])

    search_context_block = ""
    if search_context:
        search_context_block = f"Context from Web Search:\n{search_context}\n"

    try:
        ranking_prompt = settings.stage2_prompt.format(
            user_query=user_query,
            responses_text=responses_text,
            search_context_block=search_context_block
        )
    except KeyError as e:
        print(f"Error formatting Stage 2 prompt: {e}. Using fallback.")
        ranking_prompt = f"Question: {user_query}\n\n{responses_text}\n\nRank these responses."

    messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel
    responses = await query_models_parallel(get_council_models(), messages)

    # Format results - include both successful and failed responses
    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            if response.get('error'):
                # Include failed models with error info
                stage2_results.append({
                    "model": model,
                    "ranking": None,
                    "parsed_ranking": [],
                    "error": response.get('error'),
                    "error_message": response.get('error_message', 'Unknown error')
                })
            else:
                full_text = response.get('content', '')
                parsed = parse_ranking_from_text(full_text)
                stage2_results.append({
                    "model": model,
                    "ranking": full_text,
                    "parsed_ranking": parsed,
                    "error": None
                })

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    search_context: str = ""
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2

    Returns:
        Dict with 'model' and 'response' keys
    """
    settings = get_settings()

    # Build comprehensive context for chairman
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    search_context_block = ""
    if search_context:
        search_context_block = f"Context from Web Search:\n{search_context}\n"

    try:
        chairman_prompt = settings.stage3_prompt.format(
            user_query=user_query,
            stage1_text=stage1_text,
            stage2_text=stage2_text,
            search_context_block=search_context_block
        )
    except KeyError as e:
        print(f"Error formatting Stage 3 prompt: {e}. Using fallback.")
        chairman_prompt = f"Question: {user_query}\n\nSynthesis required."

    messages = [{"role": "user", "content": chairman_prompt}]

    # Query the chairman model
    chairman_model = get_chairman_model()
    response = await query_model(chairman_model, messages)

    if response is None:
        # Fallback if chairman fails
        return {
            "model": chairman_model,
            "response": "Error: Unable to generate final synthesis."
        }

    return {
        "model": chairman_model,
        "response": response.get('content', '')
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    settings = get_settings()
    try:
        title_prompt = settings.title_prompt.format(user_query=user_query)
    except KeyError:
        title_prompt = f"Title for: {user_query}"

    messages = [{"role": "user", "content": title_prompt}]

    # Use configured title model
    model_to_use = settings.title_model

    response = await query_model(model_to_use, messages, timeout=30.0)

    if response is None:
        # Fallback to a generic title
        return "New Conversation"

    content = response.get('content')
    if not content:
        return "New Conversation"
        
    title = content.strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


async def generate_search_query(user_query: str) -> str:
    """
    Generate optimized search terms from the user's question.

    Args:
        user_query: The user's full question

    Returns:
        Optimized search query string
    """
    settings = get_settings()
    try:
        prompt = settings.search_query_prompt.format(user_query=user_query)
    except KeyError:
        prompt = f"Search terms for: {user_query}"

    messages = [{"role": "user", "content": prompt}]

    # Use configured search query model
    model_to_use = settings.search_query_model

    response = await query_model(model_to_use, messages, timeout=15.0)

    if response is None:
        # Fallback: return original query truncated
        return user_query[:100]

    search_query = response.get('content', user_query).strip()

    # Clean up - remove quotes, limit length
    search_query = search_query.strip('"\'')

    # If the model returned something too short or empty, use original
    if len(search_query) < 5:
        return user_query[:100]

    return search_query[:100]


async def run_full_council(user_query: str, use_web_search: bool = False) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question
        use_web_search: Whether to perform a web search for context

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Perform web search if requested
    search_context = ""
    search_query_used = ""
    if use_web_search:
        settings = get_settings()
        provider = SearchProvider(settings.search_provider)
        # Generate optimized search query from user's question
        search_query_used = await generate_search_query(user_query)
        # Run search in thread to avoid blocking the event loop
        search_context = await asyncio.to_thread(
            perform_web_search,
            search_query_used,
            5,
            provider,
            settings.full_content_results
        )

    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query, search_context)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results, search_context)

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results,
        search_context
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings,
        "search_query": search_query_used,  # The optimized search query used
        "search_context": search_context  # Include search context in metadata for debugging/display
    }

    return stage1_results, stage2_results, stage3_result, metadata
