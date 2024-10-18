import React, { useState } from 'react';
import Proptypes from 'prop-types';
import { Arrow } from 'STYLES/Icons';
import StackPanel from 'SRC/Containers/StackPanel';

/**
* @description Stack Panel that allows you to show object in a row.
* @param {CollapsablePanelProps} props The props passed in by Parent.
*/
function CollapsablePanel(props) {
  const [isCollapsed, setIsCollapsed] = useState(props.startsCollapsed);

  // allow child component to keep its state once it's been shown.
  const [isRendered, setIsRendered] = useState(false);

  function toggleCollapse() {
    setIsCollapsed(!isCollapsed);
    if(!isRendered) {
      setIsRendered(true);
    }
  }

  return (
    <React.Fragment>
      <div onClick={toggleCollapse}
        style={{
          width: props.width,
          height: props.height,
          border: '2px solid gray',
          display: 'flex',
          flexDirection: props.arrowOnLeft ? 'row' : 'row-reverse',
          justifyContent: props.arrowOnLeft ? null : 'flex-end',
          cursor: 'pointer',
          ...props.headerStyle,
          ...!isCollapsed ? props.collapsedHeaderStyle : null
        }} >

        <div style={{
          width: 50,
          height: '100%',
          transform: isCollapsed ? 'rotate(180deg)' : null,
          ...props.arrowStyle
        }} >
          {Arrow}
        </div>

        <div style={{
          marginLeft: 10,
          marginTop: 'auto',
          marginBottom: 'auto',
          fontWeight: 700,
          fontSize: 24,
          ...props.headerTextStyle
        }}>
          {props.header}
        </div>
      </div>

      {
        isCollapsed && !isRendered
          ? null
          : (
            <StackPanel centered={props.centered}
              isHorizontal={false}
              width={props.width}
              height='auto'
              style={{
                border: '1px solid gray',
                display: isCollapsed ? 'none' : 'flex',
                ...props.contentStyle
              }} >
              {props.children}
            </StackPanel>
          )
      }

    </React.Fragment>
  );
}

CollapsablePanel.defaultProps = {
  width: '100%',
  height: 50,
  centered: false,
  contentStyle: {},
  headerStyle: {},
  collapsedHeaderStyle: {},
  headerTextStyle: {},
  header: 'Collapse',
  arrowOnLeft: true,
  arrowStyle: {},
  startsCollapsed: false
};

CollapsablePanel.propTypes = {
  children: Proptypes.any.isRequired,

  /**
  * @description defaults to 100% of parent.
  */
  width: Proptypes.oneOfType([Proptypes.string, Proptypes.number]),

  /**
  * @description defaults to 100% of parent.
  */
  height: Proptypes.oneOfType([Proptypes.string, Proptypes.number]),

  /**
  * @description Whether this stack panel is centered horizontally to its parent.
  */
  centered: Proptypes.bool,

  /**
  * @description for when the regular props aren't enough.
  */
  contentStyle: Proptypes.object,

  /**
  * @description the style for the collapse header.
  * This is the div that holds the arrow for collapsing.
  */
  headerStyle: Proptypes.object,

  /**
  * @description the style for the header when is collapsed.
  * Style get applied on top of headerStyle.
  */
  collapsedHeaderStyle: Proptypes.object,

  /**
  * @description the style of the text in the collapse header.
  */
  headerTextStyle: Proptypes.object,

  /**
  * @description The text to show in the box that will collapse the content.
  */
  header: Proptypes.oneOfType([Proptypes.string, Proptypes.element]),

  /**
  * @description Will the arrow show up on the left or the right of the header.
  */
  arrowOnLeft: Proptypes.bool,

  /**
  * @description The style that will be applied to the arrow.
  */
  arrowStyle: Proptypes.object,

  /**
  * @description Determine whether the panel will start open or closed.
  */
  startsCollapsed: Proptypes.bool
};

export default React.memo(CollapsablePanel);