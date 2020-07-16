import React from 'react';
import Proptypes from 'prop-types';
import Home from './Home';

/**
 * @template P
* @description
* @class ReactExample
*/
class ReactExample extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      test: 'string',
      test2: 0
    };
  }

  render() {
    return (
      <Home  />
    );
  }
}

ReactExample.defaultProps = {

};

ReactExample.propTypes = {

};

export default ReactExample;