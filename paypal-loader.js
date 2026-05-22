const clientId =
  import.meta.env.VITE_PAYPAL_CLIENT_ID

const script =
  document.createElement("script")

script.src =
  `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=HNL&intent=capture`
script.async =
  true

document.head.appendChild(script)