"""Web search module with multiple provider support."""

from ddgs import DDGS
from typing import List, Dict, Optional
from enum import Enum
import logging
import httpx
import os
import time

logger = logging.getLogger(__name__)

# Rate limit handling
MAX_RETRIES = 2
RETRY_DELAY = 2  # seconds


class SearchProvider(str, Enum):
    DUCKDUCKGO = "duckduckgo"
    TAVILY = "tavily"
    BRAVE = "brave"


def perform_web_search(
    query: str,
    max_results: int = 5,
    provider: SearchProvider = SearchProvider.DUCKDUCKGO,
    full_content_results: int = 3
) -> str:
    """
    Perform a web search using the specified provider.

    Args:
        query: The search query
        max_results: Maximum number of results to return
        provider: Which search provider to use
        full_content_results: Number of top results to fetch full content for (0 to disable)

    Returns:
        Formatted string with search results
    """
    try:
        if provider == SearchProvider.TAVILY:
            return _search_tavily(query, max_results)
        elif provider == SearchProvider.BRAVE:
            return _search_brave(query, max_results, full_content_results)
        else:
            return _search_duckduckgo(query, max_results, full_content_results)
    except Exception as e:
        logger.error(f"Error performing web search with {provider}: {str(e)}")
        return "[System Note: Web search was attempted but failed. Please answer based on your internal knowledge.]"


def _search_duckduckgo(query: str, max_results: int = 5, full_content_results: int = 3) -> str:
    """
    Search using DuckDuckGo (news search for better results).
    Optionally fetches full content via Jina Reader for top N results.
    """
    search_results_data = []
    urls_to_fetch = []

    for attempt in range(MAX_RETRIES + 1):
        try:
            with DDGS() as ddgs:
                search_results = list(ddgs.news(query, max_results=max_results))

                for i, result in enumerate(search_results, 1):
                    title = result.get('title', 'No Title')
                    href = result.get('url', result.get('href', '#'))
                    body = result.get('body', result.get('excerpt', 'No description available.'))
                    source = result.get('source', '')

                    search_results_data.append({
                        'index': i,
                        'title': title,
                        'url': href,
                        'source': source,
                        'summary': body,
                        'content': None
                    })

                    # Queue top N results for full content fetch
                    if full_content_results > 0 and i <= full_content_results and href and href != '#':
                        urls_to_fetch.append((i - 1, href))
                break  # Success, exit retry loop

        except Exception as e:
            if "Ratelimit" in str(e) and attempt < MAX_RETRIES:
                logger.warning(f"DuckDuckGo rate limit hit, retrying in {RETRY_DELAY}s...")
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
                raise

    # Fetch full content via Jina Reader for top results
    for idx, url in urls_to_fetch:
        content = _fetch_with_jina(url)
        if content:
            # If content is very short (likely paywall/cookie wall/failed parse),
            # append the original summary to ensure we have some info.
            if len(content) < 500:
                original_summary = search_results_data[idx]['summary']
                content += f"\n\n[System Note: Full content fetch yielded limited text. Appending original summary.]\nOriginal Summary: {original_summary}"
            search_results_data[idx]['content'] = content

    if not search_results_data:
        return "No web search results found."

    # Format results
    formatted = []
    for r in search_results_data:
        text = f"Result {r['index']}:\nTitle: {r['title']}\nURL: {r['url']}"
        if r['source']:
            text += f"\nSource: {r['source']}"
        if r['content']:
            # Truncate content to ~2000 chars
            content = r['content'][:2000]
            if len(r['content']) > 2000:
                content += "..."
            text += f"\nContent:\n{content}"
        else:
            text += f"\nSummary: {r['summary']}"
        formatted.append(text)

    return "\n\n".join(formatted)


def _fetch_with_jina(url: str, timeout: float = 25.0) -> Optional[str]:
    """
    Fetch article content using Jina Reader API.
    Returns clean markdown content.
    """
    try:
        jina_url = f"https://r.jina.ai/{url}"
        with httpx.Client(timeout=timeout) as client:
            response = client.get(jina_url, headers={
                "Accept": "text/plain",
            })
            if response.status_code == 200:
                return response.text
            else:
                logger.warning(f"Jina Reader returned {response.status_code} for {url}")
                return None
    except httpx.TimeoutException:
        logger.warning(f"Timeout while fetching content via Jina for {url}")
        return None
    except Exception as e:
        logger.warning(f"Failed to fetch content via Jina for {url}: {e}")
        return None


def _search_tavily(query: str, max_results: int = 5) -> str:
    """
    Search using Tavily API (designed for LLM/RAG use cases).
    Requires TAVILY_API_KEY environment variable.
    """
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        logger.error("TAVILY_API_KEY not set")
        return "[System Note: Tavily API key not configured. Please add TAVILY_API_KEY to your environment.]"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": api_key,
                    "query": query,
                    "max_results": max_results,
                    "include_answer": False,
                    "include_raw_content": False,
                    "search_depth": "advanced",
                },
            )
            response.raise_for_status()
            data = response.json()

        results = []
        for i, result in enumerate(data.get("results", []), 1):
            title = result.get("title", "No Title")
            url = result.get("url", "#")
            content = result.get("content", "No content available.")

            text = f"Result {i}:\nTitle: {title}\nURL: {url}\nContent:\n{content}"
            results.append(text)

        if not results:
            return "No web search results found."

        return "\n\n".join(results)

    except httpx.HTTPStatusError as e:
        logger.error(f"Tavily API error: {e.response.status_code} - {e.response.text}")
        return "[System Note: Tavily search failed. Please check your API key.]"
    except Exception as e:
        logger.error(f"Tavily search error: {e}")
        return "[System Note: Tavily search failed. Please try again.]"


def _search_brave(query: str, max_results: int = 5, full_content_results: int = 3) -> str:
    """
    Search using Brave Search API.
    Optionally fetches full content via Jina Reader for top N results.
    Requires BRAVE_API_KEY environment variable.
    """
    api_key = os.environ.get("BRAVE_API_KEY")
    if not api_key:
        logger.error("BRAVE_API_KEY not set")
        return "[System Note: Brave API key not configured. Please add your Brave API key in settings.]"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={
                    "q": query,
                    "count": max_results,
                },
                headers={
                    "Accept": "application/json",
                    "X-Subscription-Token": api_key,
                },
            )
            response.raise_for_status()
            data = response.json()

        search_results_data = []
        urls_to_fetch = []
        web_results = data.get("web", {}).get("results", [])

        for i, result in enumerate(web_results[:max_results], 1):
            title = result.get("title", "No Title")
            url = result.get("url", "#")
            description = result.get("description", "No description available.")

            # Some results have extra_snippets with more content
            extra = result.get("extra_snippets", [])
            if extra:
                description += "\n" + "\n".join(extra[:2])

            search_results_data.append({
                'index': i,
                'title': title,
                'url': url,
                'summary': description,
                'content': None
            })

            # Queue top N results for full content fetch
            if full_content_results > 0 and i <= full_content_results and url and url != '#':
                urls_to_fetch.append((i - 1, url))

        # Fetch full content via Jina Reader for top results
        for idx, url in urls_to_fetch:
            content = _fetch_with_jina(url)
            if content:
                # If content is very short, append summary
                if len(content) < 500:
                    original_summary = search_results_data[idx]['summary']
                    content += f"\n\n[System Note: Full content fetch yielded limited text. Appending original summary.]\nOriginal Summary: {original_summary}"
                search_results_data[idx]['content'] = content

        if not search_results_data:
            return "No web search results found."

        # Format results
        formatted = []
        for r in search_results_data:
            text = f"Result {r['index']}:\nTitle: {r['title']}\nURL: {r['url']}"
            if r['content']:
                # Truncate content to ~2000 chars
                content = r['content'][:2000]
                if len(r['content']) > 2000:
                    content += "..."
                text += f"\nContent:\n{content}"
            else:
                text += f"\nSummary: {r['summary']}"
            formatted.append(text)

        return "\n\n".join(formatted)

    except httpx.HTTPStatusError as e:
        logger.error(f"Brave API error: {e.response.status_code} - {e.response.text}")
        return "[System Note: Brave search failed. Please check your API key.]"
    except Exception as e:
        logger.error(f"Brave search error: {e}")
        return "[System Note: Brave search failed. Please try again.]"
