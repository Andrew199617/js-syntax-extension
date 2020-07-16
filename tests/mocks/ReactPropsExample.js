import React from 'react';
import Proptypes from 'prop-types';
import Home from './Home';

/**
 * @template P
* @description
*/
class ReactExample extends React.Component {
  render() {
    return (
      <Home  />
    );
  }
}

ReactExample.defaultProps = {

};

ReactExample.propTypes = {
  test: Proptypes.string.isRequired,

  /**
  * @description test.
  * @type {string}
  */
  test2: Proptypes.string.isRequired
};

export default ReactExample;