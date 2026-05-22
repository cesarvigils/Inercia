const clientId =
  import.meta.env.VITE_PAYPAL_CLIENT_ID

if (!clientId) {
  console.error("Falta VITE_PAYPAL_CLIENT_ID")
} else {
  const script =
    document.createElement("script")

  script.src =
    `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=capture`

  script.async =
    true

  script.onload = () => {
    window.dispatchEvent(new Event("paypal-loaded"))
  }

  document.head.appendChild(script)
}