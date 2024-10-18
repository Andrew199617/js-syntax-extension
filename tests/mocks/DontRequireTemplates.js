/**
 * @template Props
* @description
* @type {DontRequireTemplatesType}
* @extends {BaseDontRequireTemplatesType<Props>}
*/
const DontRequireTemplates = {
  /**
  * @description Initialize an instance of DontRequireTemplates.
  * @returns {DontRequireTemplatesType}
  */
  create() {
    const dontRequireTemplates = Object.create(DontRequireTemplates);
    return dontRequireTemplates;
  }
};

export default DontRequireTemplates;