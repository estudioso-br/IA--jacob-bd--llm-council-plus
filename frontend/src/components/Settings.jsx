import { useState, useEffect } from 'react';
import { api } from '../api';
import './Settings.css';

const SEARCH_PROVIDERS = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    description: 'News search. Fast and free.',
    requiresKey: false,
    keyType: null,
  },
  {
    id: 'tavily',
    name: 'Tavily',
    description: 'Purpose-built for LLMs. Returns rich, relevant content. Requires API key.',
    requiresKey: true,
    keyType: 'tavily',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    description: 'Privacy-focused search. 2,000 free queries/month. Requires API key.',
    requiresKey: true,
    keyType: 'brave',
  },
];

const LLM_PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', description: 'Use cloud-based models' },
  { id: 'ollama', name: 'Ollama', description: 'Use local models' },
  { id: 'hybrid', name: 'Hybrid', description: 'Mix cloud and local models' }
];

export default function Settings({ onClose, ollamaStatus, onRefreshOllama }) {
  const [settings, setSettings] = useState(null);
  const [selectedSearchProvider, setSelectedSearchProvider] = useState('duckduckgo');
  const [fullContentResults, setFullContentResults] = useState(3);

  // LLM Provider State
  const [selectedLlmProvider, setSelectedLlmProvider] = useState('openrouter');

  // OpenRouter State
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [isTestingOpenRouter, setIsTestingOpenRouter] = useState(false);
  const [openrouterTestResult, setOpenrouterTestResult] = useState(null);

  // Ollama State
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://localhost:11434');
  const [ollamaCouncilModels, setOllamaCouncilModels] = useState([]);
  const [ollamaChairmanModel, setOllamaChairmanModel] = useState('');
  const [ollamaAvailableModels, setOllamaAvailableModels] = useState([]);
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [ollamaTestResult, setOllamaTestResult] = useState(null);

  // Hybrid State
  const [hybridCouncilModels, setHybridCouncilModels] = useState([]);
  const [hybridChairmanModel, setHybridChairmanModel] = useState('');

  // Track filter preference for Hybrid mode rows (index -> 'remote' | 'local')
  // We initialize this lazily during render or effects
  const [hybridRowFilters, setHybridRowFilters] = useState({});

  // Search API Keys
  const [tavilyApiKey, setTavilyApiKey] = useState('');
  const [braveApiKey, setBraveApiKey] = useState('');
  const [isTestingTavily, setIsTestingTavily] = useState(false);
  const [isTestingBrave, setIsTestingBrave] = useState(false);
  const [tavilyTestResult, setTavilyTestResult] = useState(null);
  const [braveTestResult, setBraveTestResult] = useState(null);

  // Utility Models State
  const [searchQueryModel, setSearchQueryModel] = useState('');
  const [titleModel, setTitleModel] = useState('');

  // System Prompts State
  const [prompts, setPrompts] = useState({
    stage1_prompt: '',
    stage2_prompt: '',
    stage3_prompt: '',
    title_prompt: '',
    search_query_prompt: ''
  });
  const [activePromptTab, setActivePromptTab] = useState('stage1');

  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showFreeOnly, setShowFreeOnly] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);

      setSelectedSearchProvider(data.search_provider || 'duckduckgo');
      setFullContentResults(data.full_content_results ?? 3);

      setSelectedLlmProvider(data.llm_provider || 'openrouter');

      setCouncilModels(data.council_models || []);
      setChairmanModel(data.chairman_model || '');

      setOllamaBaseUrl(data.ollama_base_url || 'http://localhost:11434');
      setOllamaCouncilModels(data.ollama_council_models || []);
      setOllamaChairmanModel(data.ollama_chairman_model || '');

      setHybridCouncilModels(data.hybrid_council_models || []);
      setHybridChairmanModel(data.hybrid_chairman_model || '');

      setSearchQueryModel(data.search_query_model || 'google/gemini-2.5-flash');
      setTitleModel(data.title_model || 'google/gemini-2.5-flash');

      setPrompts({
        stage1_prompt: data.stage1_prompt || '',
        stage2_prompt: data.stage2_prompt || '',
        stage3_prompt: data.stage3_prompt || '',
        title_prompt: data.title_prompt || '',
        search_query_prompt: data.search_query_prompt || ''
      });

      // Load OpenRouter models
      loadModels();
      // Load Ollama models
      loadOllamaModels(data.ollama_base_url || 'http://localhost:11434');

    } catch (err) {
      setError('Failed to load settings');
    }
  };

  const loadModels = async () => {
    setIsLoadingModels(true);
    try {
      const data = await api.getModels();
      if (data.models && data.models.length > 0) {
        // Sort models alphabetically
        const sorted = data.models.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setAvailableModels(sorted);
      } else if (data.error) {
        console.warn('Failed to load OpenRouter models:', data.error);
      }
    } catch (err) {
      console.warn('Failed to load OpenRouter models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const loadOllamaModels = async (baseUrl) => {
    try {
      const data = await api.getOllamaModels(baseUrl);
      if (data.models && data.models.length > 0) {
        // Sort models alphabetically
        const sorted = data.models.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setOllamaAvailableModels(sorted);
      }
    } catch (err) {
      console.warn('Failed to load Ollama models:', err);
    }
  };

  // Auto-populate Ollama defaults if empty and models are available
  useEffect(() => {
    if (selectedLlmProvider === 'ollama' && ollamaAvailableModels.length > 0) {
      // Only populate if completely empty
      if (ollamaCouncilModels.length === 0) {
        const count = Math.min(ollamaAvailableModels.length, 4);
        setOllamaCouncilModels(ollamaAvailableModels.slice(0, count).map(m => m.id));
      }
      if (!ollamaChairmanModel) {
        setOllamaChairmanModel(ollamaAvailableModels[0].id);
      }
    }
  }, [selectedLlmProvider, ollamaAvailableModels]);

  // Auto-populate Hybrid defaults if empty
  useEffect(() => {
    if (selectedLlmProvider === 'hybrid' && hybridCouncilModels.length === 0) {
      // Default to the standard OpenRouter council if available
      // We can't easily access the 'defaults' from API here without a call, 
      // but we can use the 'councilModels' state if it's populated (which comes from defaults usually)
      // Or better, just wait for user to hit Reset, OR populate with available OpenRouter models
      if (councilModels.length > 0) {
        setHybridCouncilModels(councilModels);
      } else if (availableModels.length >= 4) {
        // Fallback if councilModels not ready
        setHybridCouncilModels(availableModels.slice(0, 4).map(m => m.id));
      }

      if (!hybridChairmanModel && chairmanModel) {
        setHybridChairmanModel(chairmanModel);
      }
    }
  }, [selectedLlmProvider, councilModels, availableModels]);

  const handleTestTavily = async () => {
    if (!tavilyApiKey) {
      setTavilyTestResult({ success: false, message: 'Please enter an API key first' });
      return;
    }
    setIsTestingTavily(true);
    setTavilyTestResult(null);
    try {
      const result = await api.testTavilyKey(tavilyApiKey);
      setTavilyTestResult(result);
    } catch (err) {
      setTavilyTestResult({ success: false, message: 'Test failed' });
    } finally {
      setIsTestingTavily(false);
    }
  };

  const handleTestBrave = async () => {
    if (!braveApiKey) {
      setBraveTestResult({ success: false, message: 'Please enter an API key first' });
      return;
    }
    setIsTestingBrave(true);
    setBraveTestResult(null);
    try {
      const result = await api.testBraveKey(braveApiKey);
      setBraveTestResult(result);
    } catch (err) {
      setBraveTestResult({ success: false, message: 'Test failed' });
    } finally {
      setIsTestingBrave(false);
    }
  };

  const handleTestOpenRouter = async () => {
    if (!openrouterApiKey && !settings.openrouter_api_key_set) {
      setOpenrouterTestResult({ success: false, message: 'Please enter an API key first' });
      return;
    }
    setIsTestingOpenRouter(true);
    setOpenrouterTestResult(null);
    try {
      // If input is empty but key is configured, pass null to test the saved key
      const keyToTest = openrouterApiKey || null;
      const result = await api.testOpenRouterKey(keyToTest);
      setOpenrouterTestResult(result);
    } catch (err) {
      setOpenrouterTestResult({ success: false, message: 'Test failed' });
    } finally {
      setIsTestingOpenRouter(false);
    }
  };

  const handleTestOllama = async () => {
    setIsTestingOllama(true);
    setOllamaTestResult(null);
    try {
      const result = await api.testOllamaConnection(ollamaBaseUrl);
      setOllamaTestResult(result);
      if (result.success) {
        // Refresh models if connection succeeds
        // We trigger this via a dummy backend update or just assume previous load worked
        // Actually, we should call the model fetch endpoint again but it relies on saved settings usually
        // Let's just rely on the test result for now
      }
    } catch (err) {
      setOllamaTestResult({ success: false, message: 'Connection failed' });
    } finally {
      setIsTestingOllama(false);
    }
  };

  const handleCouncilModelChange = (index, modelId) => {
    if (selectedLlmProvider === 'openrouter') {
      setCouncilModels(prev => {
        const updated = [...prev];
        updated[index] = modelId;
        return updated;
      });
    } else if (selectedLlmProvider === 'ollama') {
      setOllamaCouncilModels(prev => {
        const updated = [...prev];
        updated[index] = modelId;
        return updated;
      });
    } else {
      setHybridCouncilModels(prev => {
        const updated = [...prev];
        updated[index] = modelId;
        return updated;
      });
    }
  };

  const handleAddCouncilMember = () => {
    if (selectedLlmProvider === 'openrouter') {
      const filteredModels = showFreeOnly
        ? availableModels.filter(m => m.is_free)
        : availableModels;
      if (filteredModels.length > 0) {
        setCouncilModels(prev => [...prev, filteredModels[0].id]);
      }
    } else if (selectedLlmProvider === 'ollama') {
      if (ollamaAvailableModels.length > 0) {
        setOllamaCouncilModels(prev => [...prev, ollamaAvailableModels[0].id]);
      }
    } else {
      // For hybrid, try adding OpenRouter model first, then Ollama
      const filteredModels = showFreeOnly
        ? availableModels.filter(m => m.is_free)
        : availableModels;

      if (filteredModels.length > 0) {
        setHybridCouncilModels(prev => [...prev, filteredModels[0].id]);
      } else if (ollamaAvailableModels.length > 0) {
        setHybridCouncilModels(prev => [...prev, `ollama:${ollamaAvailableModels[0].id}`]);
      }
    }
  };

  const handleRemoveCouncilMember = (index) => {
    if (selectedLlmProvider === 'openrouter') {
      setCouncilModels(prev => prev.filter((_, i) => i !== index));
    } else if (selectedLlmProvider === 'ollama') {
      setOllamaCouncilModels(prev => prev.filter((_, i) => i !== index));
    } else {
      setHybridCouncilModels(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handlePromptChange = (key, value) => {
    setPrompts(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleResetPrompt = async (key) => {
    try {
      const defaults = await api.getDefaultSettings();
      if (defaults[key]) {
        handlePromptChange(key, defaults[key]);
      }
    } catch (err) {
      console.error("Failed to fetch default prompt", err);
    }
  };

  const handleResetToDefaults = async () => {
    try {
      const defaults = await api.getDefaultSettings();
      if (selectedLlmProvider === 'openrouter') {
        setCouncilModels(defaults.council_models);
        setChairmanModel(defaults.chairman_model);
      } else if (selectedLlmProvider === 'ollama') {
        // Defaults for Ollama: try to pick up to 4 models, fallback to minimum 2
        if (ollamaAvailableModels.length >= 2) {
          // Take up to 4, or however many are available
          const count = Math.min(ollamaAvailableModels.length, 4);
          setOllamaCouncilModels(ollamaAvailableModels.slice(0, count).map(m => m.id));
          setOllamaChairmanModel(ollamaAvailableModels[0].id);
        }
      } else {
        // Defaults for Hybrid: Use standard OpenRouter models
        setHybridCouncilModels(defaults.council_models);
        setHybridChairmanModel(defaults.chairman_model);
      }
    } catch (err) {
      setError('Failed to load default settings');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const updates = {
        search_provider: selectedSearchProvider,
        full_content_results: fullContentResults,
        llm_provider: selectedLlmProvider,
        ollama_base_url: ollamaBaseUrl,
        ollama_council_models: ollamaCouncilModels,
        ollama_chairman_model: ollamaChairmanModel,
        hybrid_council_models: hybridCouncilModels,
        hybrid_chairman_model: hybridChairmanModel,
        council_models: councilModels,
        chairman_model: chairmanModel,

        // Utility Models
        search_query_model: searchQueryModel,
        title_model: titleModel,

        // Prompts
        ...prompts
      };

      // Only send API keys if they've been changed
      if (tavilyApiKey && !tavilyApiKey.startsWith('•')) {
        updates.tavily_api_key = tavilyApiKey;
      }
      if (braveApiKey && !braveApiKey.startsWith('•')) {
        updates.brave_api_key = braveApiKey;
      }
      if (openrouterApiKey && !openrouterApiKey.startsWith('•')) {
        updates.openrouter_api_key = openrouterApiKey;
      }

      await api.updateSettings(updates);
      setSuccess(true);
      setTavilyApiKey('');
      setBraveApiKey('');
      setOpenrouterApiKey('');

      await loadSettings();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const getRowFilter = (index, modelId) => {
    // If we have an explicit user choice, use it
    if (hybridRowFilters[index]) return hybridRowFilters[index];

    // Otherwise infer from the model ID
    if (modelId && modelId.toString().startsWith('ollama:')) return 'local';
    return 'remote'; // Default to remote
  };

  const toggleRowFilter = (index, type) => {
    setHybridRowFilters(prev => ({
      ...prev,
      [index]: type
    }));
  };

  // Same for Chairman
  const [chairmanFilter, setChairmanFilter] = useState(null);
  const getChairmanFilter = (currentId) => {
    if (chairmanFilter) return chairmanFilter;
    if (currentId && currentId.toString().startsWith('ollama:')) return 'local';
    return 'remote';
  };

  if (!settings) {
    return (
      <div className="settings-overlay">
        <div className="settings-modal">
          <div className="settings-loading">Loading settings...</div>
        </div>
      </div>
    );
  }

  const selectedProviderInfo = SEARCH_PROVIDERS.find(p => p.id === selectedSearchProvider);
  let currentAvailableModels = [];
  let currentCouncilModels = [];
  let currentChairmanModel = '';

  if (selectedLlmProvider === 'openrouter') {
    currentAvailableModels = availableModels;
    currentCouncilModels = councilModels;
    currentChairmanModel = chairmanModel;
  } else if (selectedLlmProvider === 'ollama') {
    currentAvailableModels = ollamaAvailableModels;
    currentCouncilModels = ollamaCouncilModels;
    currentChairmanModel = ollamaChairmanModel;
  } else {
    // Hybrid: Merge models
    const openRouterMapped = availableModels.map(m => ({ ...m, name: `${m.name || m.id} (OpenRouter)` }));
    const ollamaMapped = ollamaAvailableModels.map(m => ({
      ...m,
      id: `ollama:${m.id}`,
      name: `${m.name || m.id} (Local)`
    }));
    // Merge and sort alphabetically
    currentAvailableModels = [...openRouterMapped, ...ollamaMapped].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    currentCouncilModels = hybridCouncilModels;
    currentChairmanModel = hybridChairmanModel;
  }

  const filteredModels = (selectedLlmProvider !== 'ollama' && showFreeOnly)
    ? currentAvailableModels.filter(m => m.is_free || m.id.startsWith('ollama:')) // Assume local is free/allowed
    : currentAvailableModels;

  const chairmanModels = (selectedLlmProvider === 'ollama')
    ? currentAvailableModels
    : currentAvailableModels.filter(m => !m.is_free || (m.id && m.id.startsWith('ollama:')));

  const getFilteredModels = (filter) => {
    if (!filter) return chairmanModels;
    if (filter === 'local') return chairmanModels.filter(m => m.id.startsWith('ollama:'));
    return chairmanModels.filter(m => !m.id.startsWith('ollama:'));
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>

        <div className="settings-content">

          {/* LLM Provider Section */}
          <section className="settings-section">
            <h3>LLM Provider</h3>
            <p className="section-description">
              Choose between cloud-based models (OpenRouter), local models (Ollama), or a mix.
            </p>
            <div className="provider-options">
              {LLM_PROVIDERS.map(provider => (
                <label
                  key={provider.id}
                  className={`provider-option ${selectedLlmProvider === provider.id ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="llm_provider"
                    value={provider.id}
                    checked={selectedLlmProvider === provider.id}
                    onChange={() => setSelectedLlmProvider(provider.id)}
                  />
                  <div className="provider-info">
                    <span className="provider-name">{provider.name}</span>
                    <span className="provider-description">{provider.description}</span>
                  </div>
                </label>
              ))}
            </div>

            {/* OpenRouter Config (Show in OpenRouter OR Hybrid) */}
            {(selectedLlmProvider === 'openrouter' || selectedLlmProvider === 'hybrid') && (
              <div className="api-key-section">
                <label>OpenRouter API Key</label>
                <div className="api-key-input-row">
                  <input
                    type="password"
                    placeholder={settings.openrouter_api_key_set ? '••••••••••••••••' : 'Enter API key'}
                    value={openrouterApiKey}
                    onChange={e => {
                      setOpenrouterApiKey(e.target.value);
                      setOpenrouterTestResult(null);
                    }}
                    className={settings.openrouter_api_key_set && !openrouterApiKey ? 'key-configured' : ''}
                  />
                  <button
                    type="button"
                    className="test-button"
                    onClick={handleTestOpenRouter}
                    disabled={isTestingOpenRouter || (!openrouterApiKey && !settings.openrouter_api_key_set)}
                  >
                    {isTestingOpenRouter ? 'Testing...' : (settings.openrouter_api_key_set && !openrouterApiKey ? 'Retest' : 'Test')}
                  </button>
                </div>
                {settings.openrouter_api_key_set && !openrouterApiKey && (
                  <div className="key-status set">✓ API key configured</div>
                )}
                {openrouterTestResult && (
                  <div className={`test-result ${openrouterTestResult.success ? 'success' : 'error'}`}>
                    {openrouterTestResult.success ? '✓' : '✗'} {openrouterTestResult.message}
                  </div>
                )}
              </div>
            )}

            {/* Ollama Config (Show in Ollama OR Hybrid) */}
            {(selectedLlmProvider === 'ollama' || selectedLlmProvider === 'hybrid') && (
              <div className="api-key-section" style={{ marginTop: '15px' }}>
                <label>Ollama Base URL</label>
                <div className="api-key-input-row">
                  <input
                    type="text"
                    placeholder="http://localhost:11434"
                    value={ollamaBaseUrl}
                    onChange={e => {
                      setOllamaBaseUrl(e.target.value);
                      setOllamaTestResult(null);
                    }}
                  />
                  <button
                    type="button"
                    className="test-button"
                    onClick={handleTestOllama}
                    disabled={isTestingOllama}
                  >
                    {isTestingOllama ? 'Testing...' : 'Connect'}
                  </button>
                </div>
                {ollamaTestResult && (
                  <div className={`test-result ${ollamaTestResult.success ? 'success' : 'error'}`}>
                    {ollamaTestResult.success ? '✓' : '✗'} {ollamaTestResult.message}
                  </div>
                )}
                {/* Auto-connection status */}
                {ollamaStatus && ollamaStatus.connected && (
                  <div className="ollama-auto-status">
                    <span className="status-indicator connected">●</span>
                    <span className="status-text">
                      <strong>Connected to Ollama</strong> <span className="status-separator">·</span> <span className="status-time">Last checked: {new Date(ollamaStatus.lastConnected).toLocaleString()}</span>
                    </span>
                  </div>
                )}
                {ollamaStatus && !ollamaStatus.connected && !ollamaStatus.testing && (
                  <div className="ollama-auto-status">
                    <span className="status-indicator disconnected">●</span>
                    <span className="status-text">Not connected</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Utility Models Selection */}
          <section className="settings-section">
            <h3>Utility Models</h3>
            <p className="section-description">
              Select models for specific tasks like generating search queries and conversation titles.
            </p>

            {/* Search Query Model */}
            <div className="model-selector-group">
              <label>Search Query Generation</label>
              <div className="model-selector-row">
                {selectedLlmProvider === 'hybrid' && (
                  <div className="model-type-toggle">
                    <button
                      type="button"
                      className={`type-btn ${!searchQueryModel.startsWith('ollama:') ? 'active' : ''}`}
                      onClick={() => {
                        if (availableModels.length > 0) setSearchQueryModel(availableModels[0].id);
                      }}
                    >
                      Remote
                    </button>
                    <button
                      type="button"
                      className={`type-btn ${searchQueryModel.startsWith('ollama:') ? 'active' : ''}`}
                      onClick={() => {
                        if (ollamaAvailableModels.length > 0) setSearchQueryModel(`ollama:${ollamaAvailableModels[0].id}`);
                      }}
                    >
                      Local
                    </button>
                  </div>
                )}
                <select
                  value={searchQueryModel}
                  onChange={(e) => setSearchQueryModel(e.target.value)}
                  className="model-select"
                >
                  {searchQueryModel.startsWith('ollama:') ? (
                    ollamaAvailableModels.map(model => (
                      <option key={model.id} value={`ollama:${model.id}`}>
                        {model.name}
                      </option>
                    ))
                  ) : (
                    availableModels.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {/* Title Generation Model */}
            <div className="model-selector-group">
              <label>Title Generation</label>
              <div className="model-selector-row">
                {selectedLlmProvider === 'hybrid' && (
                  <div className="model-type-toggle">
                    <button
                      type="button"
                      className={`type-btn ${!titleModel.startsWith('ollama:') ? 'active' : ''}`}
                      onClick={() => {
                        if (availableModels.length > 0) setTitleModel(availableModels[0].id);
                      }}
                    >
                      Remote
                    </button>
                    <button
                      type="button"
                      className={`type-btn ${titleModel.startsWith('ollama:') ? 'active' : ''}`}
                      onClick={() => {
                        if (ollamaAvailableModels.length > 0) setTitleModel(`ollama:${ollamaAvailableModels[0].id}`);
                      }}
                    >
                      Local
                    </button>
                  </div>
                )}
                <select
                  value={titleModel}
                  onChange={(e) => setTitleModel(e.target.value)}
                  className="model-select"
                >
                  {titleModel.startsWith('ollama:') ? (
                    ollamaAvailableModels.map(model => (
                      <option key={model.id} value={`ollama:${model.id}`}>
                        {model.name}
                      </option>
                    ))
                  ) : (
                    availableModels.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
          </section>

          {/* Model Selection (Context Sensitive) */}
          <section className="settings-section">
            <h3>Model Selection</h3>

            {(selectedLlmProvider === 'openrouter' || selectedLlmProvider === 'hybrid') && (
              <div className="model-options-row">
                <label className="free-filter-label">
                  <input
                    type="checkbox"
                    checked={showFreeOnly}
                    onChange={e => setShowFreeOnly(e.target.checked)}
                  />
                  Show free OpenRouter models only
                </label>
                {isLoadingModels && <span className="loading-models">Loading models...</span>}
              </div>
            )}
            {(selectedLlmProvider === 'ollama' || selectedLlmProvider === 'hybrid') && (
              <div className="model-options-row">
                <button
                  type="button"
                  className="reset-defaults-button"
                  onClick={() => loadOllamaModels(ollamaBaseUrl)}
                >
                  Refresh Local Models
                </button>
                {ollamaAvailableModels.length === 0 && <span className="error-text">No local models found. Check connection.</span>}
              </div>
            )}

            {/* Council Members */}
            <div className="subsection" style={{ marginTop: '20px' }}>
              <h4>Council Members</h4>
              <div className="council-members">
                {currentCouncilModels.map((modelId, index) => {
                  // Determine filter mode for this row (only relevant for Hybrid)
                  const isHybrid = selectedLlmProvider === 'hybrid';
                  const filter = isHybrid ? getRowFilter(index, modelId) : null;

                  // Filter options based on mode
                  let options = filteredModels;
                  if (isHybrid) {
                    if (filter === 'local') {
                      options = filteredModels.filter(m => m.id.startsWith('ollama:'));
                    } else {
                      options = filteredModels.filter(m => !m.id.startsWith('ollama:'));
                    }
                  }

                  return (
                    <div key={index} className="council-member-row">
                      <span className="member-label">Member {index + 1}</span>

                      {isHybrid && (
                        <div className="model-type-toggle">
                          <button
                            type="button"
                            className={`type-btn ${filter === 'remote' ? 'active' : ''}`}
                            onClick={() => toggleRowFilter(index, 'remote')}
                          >
                            Remote
                          </button>
                          <button
                            type="button"
                            className={`type-btn ${filter === 'local' ? 'active' : ''}`}
                            onClick={() => toggleRowFilter(index, 'local')}
                          >
                            Local
                          </button>
                        </div>
                      )}

                      <select
                        value={modelId}
                        onChange={e => handleCouncilModelChange(index, e.target.value)}
                        className="model-select"
                      >
                        {options.map(model => (
                          <option key={model.id} value={model.id}>
                            {model.name} {model.is_free && selectedLlmProvider === 'openrouter' ? '(Free)' : ''}
                          </option>
                        ))}
                        {/* Keep current selection visible even if filtered out */}
                        {!options.find(m => m.id === modelId) && (
                          <option value={modelId}>
                            {currentAvailableModels.find(m => m.id === modelId)?.name || modelId}
                          </option>
                        )}
                      </select>
                      <button
                        type="button"
                        className="remove-member-button"
                        onClick={() => handleRemoveCouncilMember(index)}
                        disabled={currentCouncilModels.length <= 2}
                        title="Remove member"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="add-member-button"
                onClick={handleAddCouncilMember}
                disabled={filteredModels.length === 0 || currentCouncilModels.length >= 8}
              >
                + Add Council Member
              </button>
              {currentCouncilModels.length >= 6 && (selectedLlmProvider !== 'ollama') && (
                <div className="council-size-warning">
                  ⚠️ <strong>6+ members:</strong> To avoid rate limits, we'll process requests in batches of 3. Max 8 members allowed.
                </div>
              )}
              {currentCouncilModels.length >= 8 && (
                <div className="council-size-info">
                  ✓ Maximum council size (8 members) reached
                </div>
              )}
            </div>

            {/* Chairman */}
            <div className="subsection" style={{ marginTop: '20px' }}>
              <h4>Chairman Model</h4>
              <div className="chairman-selection" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {selectedLlmProvider === 'hybrid' && (
                  <div className="model-type-toggle">
                    <button
                      type="button"
                      className={`type-btn ${getChairmanFilter(currentChairmanModel) === 'remote' ? 'active' : ''}`}
                      onClick={() => setChairmanFilter('remote')}
                    >
                      Remote
                    </button>
                    <button
                      type="button"
                      className={`type-btn ${getChairmanFilter(currentChairmanModel) === 'local' ? 'active' : ''}`}
                      onClick={() => setChairmanFilter('local')}
                    >
                      Local
                    </button>
                  </div>
                )}

                <select
                  value={currentChairmanModel}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    if (selectedLlmProvider === 'openrouter') setChairmanModel(newValue);
                    else if (selectedLlmProvider === 'ollama') setOllamaChairmanModel(newValue);
                    else setHybridChairmanModel(newValue);
                  }}
                  className="model-select"
                  style={{ flex: 1 }}
                >
                  {getFilteredModels(getChairmanFilter(currentChairmanModel)).map(model => (
                    <option key={model.id} value={model.id}>
                      {model.name} {model.is_free && selectedLlmProvider === 'openrouter' ? '(Free)' : ''}
                    </option>
                  ))}
                  {/* Keep current selection visible even if filtered out */}
                  {!getFilteredModels(getChairmanFilter(currentChairmanModel)).find(m => m.id === currentChairmanModel) && currentChairmanModel && (
                    <option value={currentChairmanModel}>
                      {currentAvailableModels.find(m => m.id === currentChairmanModel)?.name || currentChairmanModel}
                      {(selectedLlmProvider !== 'ollama' && !currentChairmanModel.startsWith('ollama:')) ? ' (not recommended)' : ''}
                    </option>
                  )}
                </select>
              </div>
            </div>
          </section>

          {/* System Prompts Section */}
          <section className="settings-section">
            <h3>System Prompts</h3>
            <p className="section-description">
              Customize the system instructions for each stage of the council process.
            </p>

            <div className="prompts-tabs">
              <button
                className={`prompt-tab ${activePromptTab === 'search' ? 'active' : ''}`}
                onClick={() => setActivePromptTab('search')}
              >
                Search Query
              </button>
              <button
                className={`prompt-tab ${activePromptTab === 'title' ? 'active' : ''}`}
                onClick={() => setActivePromptTab('title')}
              >
                Title
              </button>
              <button
                className={`prompt-tab ${activePromptTab === 'stage1' ? 'active' : ''}`}
                onClick={() => setActivePromptTab('stage1')}
              >
                Stage 1
              </button>
              <button
                className={`prompt-tab ${activePromptTab === 'stage2' ? 'active' : ''}`}
                onClick={() => setActivePromptTab('stage2')}
              >
                Stage 2
              </button>
              <button
                className={`prompt-tab ${activePromptTab === 'stage3' ? 'active' : ''}`}
                onClick={() => setActivePromptTab('stage3')}
              >
                Stage 3
              </button>
            </div>

            <div className="prompt-editor">
              {activePromptTab === 'search' && (
                <div className="prompt-content">
                  <label>Search Query Generation</label>
                  <p className="section-description" style={{ marginBottom: '10px' }}>
                    Generates optimized search terms from user questions for web search.
                  </p>
                  <p className="prompt-help">Variables: <code>{'{user_query}'}</code></p>
                  <textarea
                    value={prompts.search_query_prompt}
                    onChange={(e) => handlePromptChange('search_query_prompt', e.target.value)}
                    rows={5}
                  />
                  <button className="reset-prompt-btn" onClick={() => handleResetPrompt('search_query_prompt')}>Reset to Default</button>
                </div>
              )}
              {activePromptTab === 'title' && (
                <div className="prompt-content">
                  <label>Conversation Title Generation</label>
                  <p className="section-description" style={{ marginBottom: '10px' }}>
                    Creates concise conversation titles from the first user message.
                  </p>
                  <p className="prompt-help">Variables: <code>{'{user_query}'}</code></p>
                  <textarea
                    value={prompts.title_prompt}
                    onChange={(e) => handlePromptChange('title_prompt', e.target.value)}
                    rows={5}
                  />
                  <button className="reset-prompt-btn" onClick={() => handleResetPrompt('title_prompt')}>Reset to Default</button>
                </div>
              )}
              {activePromptTab === 'stage1' && (
                <div className="prompt-content">
                  <label>Stage 1: Initial Response</label>
                  <p className="section-description" style={{ marginBottom: '10px' }}>
                    Guides council members' initial responses to user questions.
                  </p>
                  <p className="prompt-help">Variables: <code>{'{user_query}'}</code>, <code>{'{search_context_block}'}</code></p>
                  <textarea
                    value={prompts.stage1_prompt}
                    onChange={(e) => handlePromptChange('stage1_prompt', e.target.value)}
                    rows={10}
                  />
                  <button className="reset-prompt-btn" onClick={() => handleResetPrompt('stage1_prompt')}>Reset to Default</button>
                </div>
              )}
              {activePromptTab === 'stage2' && (
                <div className="prompt-content">
                  <label>Stage 2: Peer Ranking</label>
                  <p className="section-description" style={{ marginBottom: '10px' }}>
                    Instructs models how to rank and evaluate peer responses.
                  </p>
                  <p className="prompt-help">Variables: <code>{'{user_query}'}</code>, <code>{'{responses_text}'}</code>, <code>{'{search_context_block}'}</code></p>
                  <textarea
                    value={prompts.stage2_prompt}
                    onChange={(e) => handlePromptChange('stage2_prompt', e.target.value)}
                    rows={10}
                  />
                  <button className="reset-prompt-btn" onClick={() => handleResetPrompt('stage2_prompt')}>Reset to Default</button>
                </div>
              )}
              {activePromptTab === 'stage3' && (
                <div className="prompt-content">
                  <label>Stage 3: Chairman Synthesis</label>
                  <p className="section-description" style={{ marginBottom: '10px' }}>
                    Directs the chairman to synthesize a final answer from all inputs.
                  </p>
                  <p className="prompt-help">Variables: <code>{'{user_query}'}</code>, <code>{'{stage1_text}'}</code>, <code>{'{stage2_text}'}</code>, <code>{'{search_context_block}'}</code></p>
                  <textarea
                    value={prompts.stage3_prompt}
                    onChange={(e) => handlePromptChange('stage3_prompt', e.target.value)}
                    rows={10}
                  />
                  <button className="reset-prompt-btn" onClick={() => handleResetPrompt('stage3_prompt')}>Reset to Default</button>
                </div>
              )}
            </div>
          </section>

          {/* Web Search Config */}
          <section className="settings-section">
            <h3>Web Search Provider</h3>
            <div className="provider-options">
              {SEARCH_PROVIDERS.map(provider => (
                <div key={provider.id} className={`provider-option-container ${selectedSearchProvider === provider.id ? 'selected' : ''}`}>
                  <label
                    className="provider-option"
                  >
                    <input
                      type="radio"
                      name="search_provider"
                      value={provider.id}
                      checked={selectedSearchProvider === provider.id}
                      onChange={() => setSelectedSearchProvider(provider.id)}
                    />
                    <div className="provider-info">
                      <span className="provider-name">{provider.name}</span>
                      <span className="provider-description">{provider.description}</span>
                    </div>
                  </label>

                  {/* Inline API Key Input for Tavily */}
                  {selectedSearchProvider === 'tavily' && provider.id === 'tavily' && (
                    <div className="inline-api-key-section">
                      <div className="api-key-input-row">
                        <input
                          type="password"
                          placeholder={settings.tavily_api_key_set ? '••••••••••••••••' : 'Enter Tavily API key'}
                          value={tavilyApiKey}
                          onChange={e => {
                            setTavilyApiKey(e.target.value);
                            setTavilyTestResult(null);
                          }}
                          className={settings.tavily_api_key_set && !tavilyApiKey ? 'key-configured' : ''}
                        />
                        <button
                          type="button"
                          className="test-button"
                          onClick={handleTestTavily}
                          disabled={isTestingTavily || (!tavilyApiKey && !settings.tavily_api_key_set)}
                        >
                          {isTestingTavily ? 'Testing...' : (settings.tavily_api_key_set && !tavilyApiKey ? 'Retest' : 'Test')}
                        </button>
                      </div>
                      {settings.tavily_api_key_set && !tavilyApiKey && (
                        <div className="key-status set">✓ API key configured</div>
                      )}
                      {tavilyTestResult && (
                        <div className={`test-result ${tavilyTestResult.success ? 'success' : 'error'}`}>
                          {tavilyTestResult.success ? '✓' : '✗'} {tavilyTestResult.message}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Inline API Key Input for Brave */}
                  {selectedSearchProvider === 'brave' && provider.id === 'brave' && (
                    <div className="inline-api-key-section">
                      <div className="api-key-input-row">
                        <input
                          type="password"
                          placeholder={settings.brave_api_key_set ? '••••••••••••••••' : 'Enter Brave API key'}
                          value={braveApiKey}
                          onChange={e => {
                            setBraveApiKey(e.target.value);
                            setBraveTestResult(null);
                          }}
                          className={settings.brave_api_key_set && !braveApiKey ? 'key-configured' : ''}
                        />
                        <button
                          type="button"
                          className="test-button"
                          onClick={handleTestBrave}
                          disabled={isTestingBrave || (!braveApiKey && !settings.brave_api_key_set)}
                        >
                          {isTestingBrave ? 'Testing...' : (settings.brave_api_key_set && !braveApiKey ? 'Retest' : 'Test')}
                        </button>
                      </div>
                      {settings.brave_api_key_set && !braveApiKey && (
                        <div className="key-status set">✓ API key configured</div>
                      )}
                      {braveTestResult && (
                        <div className={`test-result ${braveTestResult.success ? 'success' : 'error'}`}>
                          {braveTestResult.success ? '✓' : '✗'} {braveTestResult.message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="full-content-section">
              <label>Full Article Fetch (Jina AI)</label>
              <p className="setting-description">
                Uses Jina AI to read the full text of the top search results. This gives the Council deeper context than just search snippets. Applies to all search providers. <strong>Set to 0 to disable.</strong>
              </p>
              <div className="full-content-input-row">
                <input
                  type="range"
                  min="0"
                  max="5"
                  value={fullContentResults}
                  onChange={e => setFullContentResults(parseInt(e.target.value, 10))}
                  className="full-content-slider"
                />
                <span className="full-content-value">{fullContentResults} results</span>
              </div>
            </div>
          </section>

        </div>

        <div className="settings-footer">
          {error && <div className="settings-error">{error}</div>}
          {success && <div className="settings-success">Settings saved!</div>}
          <div className="settings-actions">
            <button
              type="button"
              className="reset-defaults-button"
              onClick={handleResetToDefaults}
            >
              Reset to Defaults
            </button>
            <button className="cancel-button" onClick={onClose}>Cancel</button>
            <button
              className="save-button"
              onClick={handleSave}
              disabled={isSaving || currentCouncilModels.length === 0}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div >
    </div >
  );
}