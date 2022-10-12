export class CustomCheck {
  public static convertCheckbox(checkbox: HTMLInputElement) {
    checkbox.classList.add('special');
    return checkbox;
  }
}