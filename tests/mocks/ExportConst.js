import MovableModal from 'SRC/Modals/MovableModal';
import propTypes from 'prop-types';
import styles from 'SRC/Utilities/Styles';
import LabelInput from 'SRC/Text/LabelInput';
import React from 'react';

const { createReactComponent } = require('@mavega/react');

/**
 * @description The inputs you can pass to InputModal.
 * @type {ComponentInputsType}
 * @enum
 */
export const ComponentInputs = {
  TEXT: 0,
  NUMBER: 1
};

/**
* @description A modal that helps with changing input on an Object.
* @type {InputModalType}
* @extends {BaseModalType, React.PureComponent<InputModalProps>}
*/
const InputModal = {
  constructor: function InputModal() { },

  /**
  * @description Initialize an instance of InputModal.
  * @returns {InputModalType}
  */
  create() {
    const inputModal = Oloo.assign(MovableModal.create(), InputModal);

    inputModal.modalStyle = {
      ...inputModal.modalStyle,
      ...styles.messageBoxStyle
    };

    return inputModal;
  },

  setObject(i) {
    return (value => {
      const input = this.props.inputs[i];
      if(input.type === ComponentInputs.NUMBER) {
        value = +value;
      }

      this.props.onChange(input.name, value);
    }).bind(this);
  },

  buttons() {
    return (
      <div style={{ width: '100%', height: '20%', marginLeft: '20%' }}>
        <button className='btn btn-danger' onDelete={this.props.onDelete} >
          Delete
        </button>
      </div>
    );
  },

  renderBody() {
    const body = [];

    for(let i = 0; i < this.props.inputs.length; ++i) {
      const input = this.props.inputs[i];
      if(input.type === ComponentInputs.TEXT || input.type === ComponentInputs.NUMBER) {
        body.push(<React.Fragment key={i} >
          <LabelInput
            getObject={() => `${input.value}`}
            labelStyle={{ width: '50%' }}
            inputStyle={{ width: '50%' }}
            name={input.name}
            scale={true}
            style={{ marginLeft: '10%', width: '80%', height: `${60 / this.props.inputs.length}%` }}
            setObject={this.setObject(i)} />
        </React.Fragment>);
      }
    }

    return (
      <React.Fragment>
        {this.renderCloseButton(this.props.onClosed)}
        <h1 style={{ textAlign: 'center', height: '20%', maxHeight: 80, marginBottom: 20 }}>Edit Component</h1>
        {body}
        {this.buttons()}
      </React.Fragment>
    );
  },

  render() {
    const minHeight = 150;
    const minHeightInput = 60;
    return this.renderModal(
      this.renderBody(),
      { height: this.props.inputs.length * minHeightInput + minHeight },
      this.props.onClosed
    );
  }
};

InputModal.propTypes = {
  /**
   * @description An array of inputs to handle.
   * @type {{name: string, type: ComponentInputsEnum, value: any}[]}
   */
  inputs: propTypes.array.isRequired,

  /**
  * @description Function called when we want to close this modal.
  */
  onClosed: propTypes.func.isRequired,

  /**
  * @description a function that gets called when a input changes. returns an object
  */
  onChange: propTypes.func.isRequired
};

export default createReactComponent(InputModal);