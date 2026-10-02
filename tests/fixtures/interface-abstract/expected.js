const { Oloo } = require('@mavega/oloo');

/** @typedef {{read: () => string, readonly name: string}} IReadable */


/** @typedef {{write: (content: string) => void, name: string}} IWritable */


/** @typedef {{read: () => string, name: string, write: (content: string) => void, size: () => number}} IStore */


const StoreBase = {
    /**
     * @param {string} name
     */
    create(name) {
        const _lgdInstance = Object.create(StoreBase);
        (function() {
        /** @type {String} */
        this.storeName = name;
    
        }).apply(_lgdInstance, arguments);
        return _lgdInstance;
    },

    

    /**
     * @returns {string}
     */
      describe() {
        return this.storeName;
    },

    /**
     * @returns {string}
     */
     getName() {
        return this.storeName;
    },
};

const MemoryStore = {
    /**
     * @param {string} name
     */
    create(name) {
        const _lgdInstance = Oloo.assign(StoreBase.create(name), MemoryStore);
        (function() {
        /** @type {Object} */
        this.entries = {};
    
        }).apply(_lgdInstance, arguments);
        return _lgdInstance;
    },

    /**
     * @returns {number}
     */
      size() {
        return Object.keys(this.entries).length;
    },

    /**
     * @returns {string}
     */
      describe() {
        return _lgdBaseOwner588().describe.call(this) + " (memory)";
    },

    /**
     * @returns {string}
     */
     read() {
        return this.storeName;
    },

    /**
     * @param {string} content
     * @returns {undefined}
     */
     write(content) {
        this.entries[content] = true;
    },

    /**
     * @returns {string}
     */
    get  name() {
        return this.storeName;
    },

    /**
     * @param {string} value
     */
    set name(value) {
        this.storeName = value;
    },
};
/** @returns {typeof StoreBase} */
const _lgdBaseOwner588 = () => Object.getPrototypeOf(MemoryStore);

module.exports = MemoryStore;
