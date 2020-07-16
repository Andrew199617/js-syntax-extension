
declare interface ReactExampleProps {};

declare interface ReactExampleState {
	static test: string;

	static test2: number;
};

/**
 * @template P
* @description
* @class ReactExample
*/
declare interface ReactExampleType<P> extends React.Component<ReactExampleProps, ReactExampleState>  {
	constructor(props: any): ReactExampleType;

	render(): JSX.Element;
}
