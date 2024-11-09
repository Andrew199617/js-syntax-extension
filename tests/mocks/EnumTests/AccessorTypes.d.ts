
/**
* @description Represents the types of accessors that can be parsed.
* @type {AccessorTypesType}
*/
declare interface AccessorTypesType {
	static NONE: AccessorTypesEnum.NONE;

	static PRIVATE: AccessorTypesEnum.PRIVATE;

	static PROTECTED: AccessorTypesEnum.PROTECTED;

	static PUBLIC: AccessorTypesEnum.PUBLIC;

	static STATIC: AccessorTypesEnum.STATIC;

	static ASYNC: AccessorTypesEnum.ASYNC;

	static GET: AccessorTypesEnum.GET;

	static SET: AccessorTypesEnum.SET;
}

/**
* @description Represents the types of accessors that can be parsed.
* @type {AccessorTypesEnum}
* @enum
*/
declare enum AccessorTypesEnum {
	NONE = 0,

	PRIVATE = 1,

	PROTECTED = 2,

	PUBLIC = 4,

	STATIC = 8,

	ASYNC = 16,

	GET = 32,

	SET = 64
}
