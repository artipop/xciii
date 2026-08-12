package app

func (a *App) GetUsedCardsCount() (int, error) {
	return a.store.GetUsedCardsCount()
}
