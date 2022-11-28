export class CustomCheck {
  public static convertCheckbox(checkbox?: HTMLInputElement) {
    if(checkbox) checkbox.classList.add('special');
    return checkbox;
  }
}