// Возвращает данные для отката незавершённого жеста редактора.
// Панорамирование меняет только viewport; остальные транзакционные жесты
// хранят снимок геометрии в поле snap.
export function getPointerCancelRecovery(gesture) {
  if (gesture?.type === 'pan' && gesture.v0) {
    return { view: gesture.v0, objects: null };
  }
  return {
    view: null,
    objects: Array.isArray(gesture?.snap) ? gesture.snap : null
  };
}
