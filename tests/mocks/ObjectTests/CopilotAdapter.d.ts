
/**
 * @description Adapter for stock copilot text and JSON prompts, supporting both the GitHub Copilot SDK session API and local OpenAI-compatible endpoints.
 * @type {CopilotAdapterType}
 */
declare interface CopilotAdapterType {
	localClient: OpenAI|undefined;

	/**
	 * @description GitHub Copilot SDK client used to create and tear down sessions on demand.
	 * @type {CopilotClient|null}
	 */
	copilotSdkClient: CopilotClient|null;

	/**
	 * @description In-flight start promise so concurrent requests do not start the Copilot SDK client twice.
	 * @type {Promise<void>|null}
	 */
	_startPromise: Promise<void>|null;

	model: string;

	/**
	 * @description Creates a new adapter instance and resolves the local endpoint and model from environment variables.
	 * STOCK_AI_BASE_URL, OPENAI_BASE_URL, or LLAMA_SERVER_URL enable the local OpenAI-compatible client.
	 * STOCK_AI_API_KEY, OPENAI_API_KEY, OPENAI_KEY, or OPENAI provide the local client key.
	 * STOCK_AI_MODEL overrides the model name; otherwise local mode defaults to SmartQwen and Copilot mode defaults to gpt-5.4-mini.
	 * @returns {CopilotAdapterType}
	 */
	create(): CopilotAdapterType;

	/**
	 * @description Whether the adapter has a local client or Copilot SDK client instance ready to start a session.
	 * This is a construction-time check, not a live auth or connectivity probe.
	 * @returns {boolean}
	 */
	isConfigured(): boolean;

	/**
	 * @description Runs a text-based stock copilot prompt.
	 * @param {StockCopilotRequest} request The request settings.
	 * @returns {Promise<string>} The assistant response content.
	 */
	runText(request: StockCopilotRequest): Promise<string>;

	/**
	 * @description Sends a stock prompt to a local OpenAI-compatible endpoint.
	 * The call uses a low temperature for deterministic responses.
	 * @param {StockCopilotRequest} request The request settings.
	 * @returns {Promise<string>} The assistant response content.
	 */
	_runTextWithLocalClient(request: StockCopilotRequest): Promise<string>;

	/**
	 * @description Runs a JSON stock copilot prompt.
	 * @param {StockCopilotRequest} request The request settings.
	 * @returns {Promise<object|null>} The parsed assistant response.
	 */
	runJson(request: StockCopilotRequest): Promise<object|null>;

	/**
	 * @description Ensures the GitHub Copilot SDK client has started before the first session is created.
	 * @returns {Promise<void>}
	 */
	_ensureStarted(): Promise<void>;

	/**
	 * @description Parses raw model text into JSON.
	 * Strips markdown fences first, then falls back to embedded-object extraction.
	 * @param {string} content Raw assistant content.
	 * @returns {object|null} Parsed JSON object or null.
	 */
	_parseJsonContent(content: string): object|null;

	/**
	 * @description Removes a single outer markdown code fence wrapper from text.
	 * @param {string} content Potential fenced markdown content.
	 * @returns {string} Unfenced content.
	 */
	_stripCodeFences(content: string): string;

	/**
	 * @description Attempts to parse the first apparent JSON object inside mixed text.
	 * @param {string} content Assistant content that may include prose around JSON.
	 * @returns {object|null} Parsed object or null when extraction fails.
	 */
	_tryParseEmbeddedJson(content: string): object|null;
}
