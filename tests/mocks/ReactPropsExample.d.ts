
declare interface ReactExampleProps {
	static test: any;

	/**
  * @description test.
  * @type {string}
  */
	static test2: string;
};

/**
 * @template P
* @description
*/
declare interface ReactExampleType<P> extends React.Component<ReactExampleProps, ReactExampleState>  {
	render(): JSX.Element;
}
