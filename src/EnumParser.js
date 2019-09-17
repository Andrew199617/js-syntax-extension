/**
* @description Parse a string enum.
* @type {EnumParserType}
*/
const EnumParser = {
  /**
  * @description Initialize an instace of EnumParser.
  * @param {FileParserType} fileParser
  * @returns {EnumParserType}
  */
  create(fileParser) {
    const enumParser = Object.assign({}, EnumParser);

    /** @type {FileParserType} */
    enumParser.fileParser = fileParser;

    return enumParser;
  },

  /**
   * @description Check an object literal comment to see if its an enum.
   * @param {string} comment
   */
  isEnum(comment) {
    return (/@enum/).test(comment);
  },

  /**
   * @description
   * @param {*} str
   */
  parse(str) {

  }
};

module.exports = EnumParser;