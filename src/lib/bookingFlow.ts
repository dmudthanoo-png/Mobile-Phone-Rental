/** Only expire the timer belonging to the currently displayed booking step. */
export function shouldExpireBooking(input: {
  step: number;
  timerStep: number | null;
  remainingSeconds: number | null;
  requestPending: boolean;
}): boolean {
  return !input.requestPending && (input.step === 3 || input.step === 4) &&
    input.timerStep === input.step && input.remainingSeconds !== null && input.remainingSeconds <= 0;
}
