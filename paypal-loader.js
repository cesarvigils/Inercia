const clientId =
  import.meta.env.VITE_PAYPAL_CLIENT_ID

if (!clientId) {
  console.error("Falta VITE_PAYPAL_CLIENT_ID")
} else if (!window.paypal) {
  const script =
    document.createElement("script")

  script.src =
    `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=capture`

  script.async =
    true

  document.head.appendChild(script)
}