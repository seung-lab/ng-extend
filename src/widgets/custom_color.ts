/* <div>
  <input type="color">
</div>
*/
export class CustomColor {
  public static convertColor(input?: HTMLInputElement) {
    if (input) {
      // append a div to the parent of input before the input element
      const div = document.createElement('div');
      div.classList.add('special', 'color-input');
      input.parentElement!.insertBefore(div, input);
      div.appendChild(input);
      input.classList.add('special');
      return div;
    }
    return input;
  }
}