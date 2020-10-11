
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

declare interface InputModalProps {
	/**
   * @description An array of inputs to handle.
   * @type {{name: string, type: ComponentInputsEnum, value: any}[]}
   */
	static inputs: {name: string, type: ComponentInputsEnum, value: any}[];

	/**
  * @description Function called when we want to close this modal.
  */
	static onClosed: any;

	/**
  * @description a function that gets called when a input changes. returns an object
  */
	static onChange: any;
};

/**
* @description A modal that helps with changing input on an Object.
* @type {InputModalType}
* @extends {BaseModalType, React.PureComponent<InputModalProps>}
*/
declare interface InputModalType extends BaseModalType, React.PureComponent<InputModalProps>, React.Component<InputModalProps, InputModalState> {
	static constructor: Object;

	modalStyle: Object;

	/**
  * @description Initialize an instance of InputModal.
  * @returns {InputModalType}
  */
	create(): InputModalType;

	setObject(i: any): null;

	buttons(): null;

	renderBody(): null;

	render(): null;
}
