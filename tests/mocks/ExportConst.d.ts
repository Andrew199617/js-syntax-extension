
/**
 * @description The inputs you can pass to InputModal.
 * @type {ComponentInputsType}
 * @enum
 */
declare interface ComponentInputsType {
	static TEXT: ComponentInputsEnum.TEXT;

	static NUMBER: ComponentInputsEnum.NUMBER;
}

/**
 * @description The inputs you can pass to InputModal.
 * @type {ComponentInputsEnum}
 * @enum
 */
declare enum ComponentInputsEnum {
	TEXT = 0,

	NUMBER = 1
}
