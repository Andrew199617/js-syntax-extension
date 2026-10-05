/** @description Models constructor-owned private backing state and the public MarkdownString accessors. */
class FakeMarkdownString
{
    #state;

    /** @description Initializes the backing state that a prototype-only clone cannot access. */
    constructor(value = '', supportThemeIcons = false)
    {
        this.#state = { value: value, supportThemeIcons: supportThemeIcons, supportHtml: false, supportAlertSyntax: false };
    }

    get value() { return this.#state.value; }

    set value(value) { this.#state.value = value; }

    get isTrusted() { return this.#state.isTrusted; }

    set isTrusted(value) { this.#state.isTrusted = value; }

    get supportThemeIcons() { return this.#state.supportThemeIcons; }

    set supportThemeIcons(value) { this.#state.supportThemeIcons = value; }

    get supportHtml() { return this.#state.supportHtml; }

    set supportHtml(value) { this.#state.supportHtml = value; }

    get supportAlertSyntax() { return this.#state.supportAlertSyntax; }

    set supportAlertSyntax(value) { this.#state.supportAlertSyntax = value; }

    get baseUri() { return this.#state.baseUri; }

    set baseUri(value) { this.#state.baseUri = value; }


    /** @description Exercises usable private backing state on a constructed replacement. */
    appendMarkdown(value)
    {
        this.#state.value += value;
        return this;
    }
}

module.exports = FakeMarkdownString;
