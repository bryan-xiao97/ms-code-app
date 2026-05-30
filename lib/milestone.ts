export const DUE_SOON_DAYS = 5;

export function dueSoon(dueDate: string, today: Date = new Date()): boolean {
  const due = new Date(dueDate);
  const diff = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= DUE_SOON_DAYS;
}
