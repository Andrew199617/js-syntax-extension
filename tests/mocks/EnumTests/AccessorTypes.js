/**
* @description Represents the types of accessors that can be parsed.
* @type {AccessorTypesType}
* @enum
*/
const AccessorTypes = {
  NONE: 0,
  PRIVATE: 1,
  PROTECTED: 2,
  PUBLIC: 4,
  STATIC: 8,
  ASYNC: 16,
  GET: 32,
  SET: 64
};

module.exports = AccessorTypes;