# Geo Module

## Ответственность

Geo-конфиг для кассы: страна, активная валюта, методы оплаты, пресеты и лимиты депозита.

## Ключевые use cases

- UC-GEO-01: Получить geo config (гость / свой игрок)
- UC-GEO-02: Валидировать фиатный метод депозита для страны и валюты
- UC-GEO-03: Конвертировать RUB-эквивалент для display (KYC UI)

## Зависит от

- `users` (UsersFacade — currency_preference, last_payment_method, country)

## Используется в

- `payments` (GeoFacade)
- `kyc` (GeoFacade — limit display)
