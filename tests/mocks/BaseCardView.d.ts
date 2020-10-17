
/**
 * @template Props, State
 * @description This class allows you to display all the cards based of a table in the firebase database.
 * The table is specified with this.tableName.
 * Card is any object with a title, description, thumbnail, and isPublished.
 * @type {BaseCardViewType}
 * @extends {BaseCardViewSharedType<Props, State>}
 */
declare interface BaseCardViewType<Props, State> extends BaseCardViewSharedType<Props, State> {
	create(parent: any, props: any): any;

	/**
   * @description shows a dropdown that lets you chose the filter.
   * @param {(FiltersEnum)[]} filters An array of filters that the user can chose.
   * @returns {JSX} dropdown allowing the choice of filter state.
   */
	renderFilter(filters: (FiltersEnum)[], style: {	}): JSX;
}
