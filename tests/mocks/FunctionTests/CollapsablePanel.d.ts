
declare interface CollapsablePanelProps {
	static children: any;

	/**
  * @description defaults to 100% of parent.
  */
	static width: any;

	/**
  * @description defaults to 100% of parent.
  */
	static height: any;

	/**
  * @description Whether this stack panel is centered horizontally to its parent.
  */
	static centered: any;

	/**
  * @description for when the regular props aren't enough.
  */
	static contentStyle: any;

	/**
  * @description the style for the collapse header.
  * This is the div that holds the arrow for collapsing.
  */
	static headerStyle: any;

	/**
  * @description the style for the header when is collapsed.
  * Style get applied on top of headerStyle.
  */
	static collapsedHeaderStyle: any;

	/**
  * @description the style of the text in the collapse header.
  */
	static headerTextStyle: any;

	/**
  * @description The text to show in the box that will collapse the content.
  */
	static header: any;

	/**
  * @description Will the arrow show up on the left or the right of the header.
  */
	static arrowOnLeft: any;

	/**
  * @description The style that will be applied to the arrow.
  */
	static arrowStyle: any;

	/**
  * @description Determine whether the panel will start open or closed.
  */
	static startsCollapsed: any;
};
