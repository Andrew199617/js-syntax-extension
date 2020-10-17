/* eslint-disable max-params */
import React from 'react';
import Dropdown from 'VISUALS/Shared/Dropdown';

import BaseCardViewShared from 'SRC/Utilities/BaseCardView.shared';

/**
 * @template Props, State
 * @description This class allows you to display all the cards based of a table in the firebase database.
 * The table is specified with this.tableName.
 * Card is any object with a title, description, thumbnail, and isPublished.
 * @type {BaseCardViewType}
 * @extends {BaseCardViewSharedType<Props, State>}
 */
const BaseCardView = {
  create(parent, props) {
    const baseCardView = Oloo.assign(BaseCardViewShared.create(parent, props), BaseCardView);
    return baseCardView;
  },

  /**
   * @description shows a dropdown that lets you chose the filter.
   * @param {(FiltersEnum)[]} filters An array of filters that the user can chose.
   * @returns {JSX} dropdown allowing the choice of filter state.
   */
  renderFilter(filters, style = { display: 'inline-block' }) {
    return (
      <div style={{ ...style, overflowY: 'visible' }}>
        <Dropdown
          onOptionSelected={this.onFilterChanged}
          options={filters}
          placeholder='Select a filter'
          value={this.state.filter} />
      </div>
    );
  }
};

export default BaseCardView;
