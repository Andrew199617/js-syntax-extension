import { CopilotClient, approveAll } from '@github/copilot-sdk';
import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-5.4-mini';
const DEFAULT_LOCAL_MODEL = 'SmartQwen';

function normalizeBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim();

  if(!normalized) {
    return '';
  }

  return normalized.replace(/\/+$/, '');
}

function getFirstTextPart(contentParts = []) {
  if(!Array.isArray(contentParts)) {
    return '';
  }

  const textPart = contentParts.find(part => typeof part?.text === 'string');
  return textPart?.text || '';
}

function getConversationRole(role) {
  if(role === 'assistant') {
    return 'assistant';
  }

  if(role === 'system') {
    return 'system';
  }

  return 'user';
}

function getConversationRoleLabel(role) {
  if(role === 'assistant') {
    return 'Assistant';
  }

  if(role === 'system') {
    return 'System';
  }

  return 'User';
}

function normalizeConversationMessages(messages) {
  if(!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  return messages.map(message => {
    const content = typeof message?.content === 'string' ? message.content.trim() : '';

    if(!content) {
      return null;
    }

    return {
      role: getConversationRole(message?.role),
      content
    };
  }).filter(Boolean);
}

function buildConversationPrompt(conversationMessages, userPrompt) {
  const normalizedMessages = normalizeConversationMessages(conversationMessages);
  const promptText = typeof userPrompt === 'string' ? userPrompt.trim() : String(userPrompt || '');

  if(normalizedMessages.length === 0) {
    return promptText;
  }

  return [
    'Conversation so far:',
    normalizedMessages.map(message => `${getConversationRoleLabel(message.role)}: ${message.content}`).join('\n'),
    'Current request:',
    promptText
  ].join('\n\n');
}

/**
 * @description Adapter for stock copilot text and JSON prompts, supporting both the GitHub Copilot SDK session API and local OpenAI-compatible endpoints.
 * @type {CopilotAdapterType}
 */
const CopilotAdapter = {
  /**
   * @description Creates a new adapter instance and resolves the local endpoint and model from environment variables.
   * STOCK_AI_BASE_URL, OPENAI_BASE_URL, or LLAMA_SERVER_URL enable the local OpenAI-compatible client.
   * STOCK_AI_API_KEY, OPENAI_API_KEY, OPENAI_KEY, or OPENAI provide the local client key.
   * STOCK_AI_MODEL overrides the model name; otherwise local mode defaults to SmartQwen and Copilot mode defaults to gpt-5.4-mini.
   * @returns {CopilotAdapterType}
   */
  create() {
    const adapter = Object.create(CopilotAdapter);
    const stockAiBaseUrl = normalizeBaseUrl(process.env.STOCK_AI_BASE_URL || process.env.OPENAI_BASE_URL || process.env.LLAMA_SERVER_URL);
    const openAiApiKey = 'local-stock-ai';

    if(stockAiBaseUrl) {
      adapter.localClient = new OpenAI({
        apiKey: openAiApiKey,
        baseURL: stockAiBaseUrl,
        dangerouslyAllowBrowser: true
      });
    }

    const gitHubToken = process.env.GITHUB_TOKEN || process.env.COPILOT_GITHUB_TOKEN;
    const clientOptions = {
      autoStart: false,
      gitHubToken
    };

    /**
     * @description GitHub Copilot SDK client used to create and tear down sessions on demand.
     * @type {CopilotClient|null}
     */
    adapter.copilotSdkClient = adapter.localClient ? null : new CopilotClient(clientOptions);

    /**
     * @description In-flight start promise so concurrent requests do not start the Copilot SDK client twice.
     * @type {Promise<void>|null}
     */
    adapter._startPromise = null;

    if(process.env.STOCK_AI_MODEL) {
      adapter.model = process.env.STOCK_AI_MODEL;
    }
    else if(adapter.localClient) {
      adapter.model = DEFAULT_LOCAL_MODEL;
    }
    else if(process.env.NODE_ENV === 'development') {
      adapter.model = DEFAULT_MODEL;
    }
    else {
      adapter.model = DEFAULT_MODEL;
    }

    return adapter;
  },

  /**
   * @description Whether the adapter has a local client or Copilot SDK client instance ready to start a session.
   * This is a construction-time check, not a live auth or connectivity probe.
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.localClient || this.copilotSdkClient);
  },

  /**
   * @description Runs a text-based stock copilot prompt.
   * @param {StockCopilotRequest} request The request settings.
   * @returns {Promise<string>} The assistant response content.
   */
  async runText(request) {
    const conversationMessages = normalizeConversationMessages(request.conversationMessages);

    if(this.localClient) {
      return await this._runTextWithLocalClient({
        ...request,
        conversationMessages
      });
    }

    if(!this.copilotSdkClient) {
      throw new Error('Stock AI is not configured');
    }

    await this._ensureStarted();

    const sessionConfig = {
      onPermissionRequest: approveAll
    };

    if(request.model || this.model) {
      sessionConfig.model = request.model || this.model;
    }

    if(request.systemPrompt) {
      sessionConfig.systemMessage = {
        mode: 'replace',
        content: request.systemPrompt
      };
    }

    const session = await this.copilotSdkClient.createSession(sessionConfig);

    try {
      const assistantMessage = await session.sendAndWait({
        prompt: buildConversationPrompt(conversationMessages, request.userPrompt || ''),
        timeout: request.timeout
      });

      return assistantMessage?.data?.content || '';
    }
    finally {
      await session.disconnect().catch(() => { });
    }
  },

  /**
   * @description Sends a stock prompt to a local OpenAI-compatible endpoint.
    * The call uses a low temperature for deterministic responses.
   * @param {StockCopilotRequest} request The request settings.
   * @returns {Promise<string>} The assistant response content.
   */
  async _runTextWithLocalClient(request) {
    const conversationMessages = normalizeConversationMessages(request.conversationMessages);
    const completionOptions = {
      model: request.model || this.model,
      messages: [
        request.systemPrompt
          ? {
            role: 'system',
            content: request.systemPrompt
          }
          : null,
        ...conversationMessages,
        {
          role: 'user',
          content: request.userPrompt || ''
        }
      ].filter(Boolean),
      temperature: 0.2
    };

    if(Number.isFinite(request.maxTokens)) {
      completionOptions['max_tokens'] = request.maxTokens;
    }

    let completion;

    if(Number.isFinite(request.timeout)) {
      completion = await this.localClient.chat.completions.create(completionOptions, {
        timeout: request.timeout
      });
    }
    else {
      completion = await this.localClient.chat.completions.create(completionOptions);
    }

    const messageContent = completion?.choices?.[0]?.message?.content;

    if(typeof messageContent === 'string') {
      return messageContent;
    }

    return getFirstTextPart(messageContent);
  },

  /**
    * @description Runs a JSON stock copilot prompt.
   * @param {StockCopilotRequest} request The request settings.
   * @returns {Promise<object|null>} The parsed assistant response.
   */
  async runJson(request) {
    const systemPrompt = [
      request.systemPrompt,
      'Return valid JSON only. Do not wrap the object in markdown.'
    ].filter(Boolean).join('\n\n');

    const content = await this.runText({
      model: request.model,
      timeout: request.timeout,
      systemPrompt,
      userPrompt: request.userPrompt,
      maxTokens: request.maxTokens,
      conversationMessages: request.conversationMessages
    });

    return this._parseJsonContent(content);
  },

  /**
   * @description Ensures the GitHub Copilot SDK client has started before the first session is created.
   * @returns {Promise<void>}
   */
  async _ensureStarted() {
    if(this._startPromise) {
      return await this._startPromise;
    }

    this._startPromise = this.copilotSdkClient.start()
      .finally(() => {
        this._startPromise = null;
      });

    return await this._startPromise;
  },

  /**
   * @description Parses raw model text into JSON.
   * Strips markdown fences first, then falls back to embedded-object extraction.
   * @param {string} content Raw assistant content.
   * @returns {object|null} Parsed JSON object or null.
   */
  _parseJsonContent(content) {
    const normalizedContent = this._stripCodeFences(String(content || '').trim());

    if(!normalizedContent) {
      return null;
    }

    try {
      return JSON.parse(normalizedContent);
    }
    catch {
      return this._tryParseEmbeddedJson(normalizedContent);
    }
  },

  /**
   * @description Removes a single outer markdown code fence wrapper from text.
   * @param {string} content Potential fenced markdown content.
   * @returns {string} Unfenced content.
   */
  _stripCodeFences(content) {
    return content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  },

  /**
   * @description Attempts to parse the first apparent JSON object inside mixed text.
   * @param {string} content Assistant content that may include prose around JSON.
   * @returns {object|null} Parsed object or null when extraction fails.
   */
  _tryParseEmbeddedJson(content) {
    const startIndex = content.indexOf('{');
    const endIndex = content.lastIndexOf('}');

    if(startIndex < 0 || endIndex <= startIndex) {
      return null;
    }

    const candidate = content.slice(startIndex, endIndex + 1);

    try {
      return JSON.parse(candidate);
    }
    catch {
      return null;
    }
  }
};

export default CopilotAdapter;
