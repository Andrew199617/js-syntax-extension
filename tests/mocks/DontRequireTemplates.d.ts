
/**
 * @template Props
* @description
* @type {DontRequireTemplatesType}
* @extends {BaseDontRequireTemplatesType<Props>}
*/
declare interface DontRequireTemplatesType<Props> extends BaseDontRequireTemplatesType<Props> {
	/**
  * @description Initialize an instance of DontRequireTemplates.
  * @returns {DontRequireTemplatesType}
  */
	create(): DontRequireTemplatesType<Props>;
}
