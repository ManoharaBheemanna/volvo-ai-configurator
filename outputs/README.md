# Volvo Sweden configurator seed

`volvo-se-configurator-seed.json` is a structured starting catalogue created from the live Volvo Cars Sweden configurator on 21 August 2026.

It includes the ten currently buildable Swedish models and the live prices, powertrains, trims and available design choices captured during the pass. The model records are intentionally honest about coverage: where Volvo's page exposes choice compatibility only after a prior selection, the record says so instead of guessing.

For a production AI configurator, use this file as the product/intent layer and add a small live sync layer:

1. Refresh the vehicle catalogue from `https://www.volvocars.com/se/build/` daily.
2. For the vehicle being discussed, resolve the selected version, trim and powertrain in the live configurator.
3. Fetch the resulting compatible paints, interiors, wheels, accessories, prices and delivery data.
4. Store the configuration as option IDs, rather than display text, and calculate the price only from the server response.

This matters because Volvo explicitly describes displayed prices as preliminary and because option availability varies with the choices made earlier in the flow.
