<div align="center">

<img src="assets/readme/inercia-logo.png" alt="Simuladores Inercia" width="420">

### Plataforma web de reservas, operaciones y administración para Simuladores Inercia.

**Reservas · Pagos · Standings · Administración · WhatsApp**
<br>

[![Website](https://img.shields.io/badge/WEB-INERCIAHN.COM-FF8B00?style=for-the-badge&labelColor=0A0A0A)](https://inerciahn.com)
![Status](https://img.shields.io/badge/STATUS-ONLINE-22C55E?style=for-the-badge&labelColor=0A0A0A)
![Version](https://img.shields.io/badge/VERSION-1.7-FF8B00?style=for-the-badge&labelColor=0A0A0A)

</div>

---

## Descripcion del Proyecto

**Simuladores Inercia** es una plataforma de simracing con un sistema web desarrollado específicamente para manejar la experiencia completa del negocio.

El proyecto conecta el sitio público de Inercia con un sistema de reservaciones, disponibilidad de simuladores, pagos, standings, cuentas de usuario y herramientas administrativas.

---

## ⚡ FEATURES

### Reservaciones

- Disponibilidad de simuladores en tiempo real
- Selección individual de rigs
- Rigs **Standard** y **Premium**
- Reservas de múltiples horas
- Prevención de reservas superpuestas
- Bloqueo temporal de rigs durante checkout
- Restricciones de horarios
- Lockdown de fechas y rangos de horas desde Admin
- Promociones automáticas
- **50% de descuento todos los martes**
- Cálculo automático del total

### Pagos

- Transferencia bancaria
- PayPal Checkout
- Conversión HNL → USD para PayPal
- Captura y verificación de pagos desde backend
- Reservas PayPal aprobadas automáticamente después del pago
- Cancelación y liberación de rigs cuando un checkout falla
- Soporte para reembolsos
- Registro de transacciones

### Usuarios

- Firebase Authentication
- Inicio de sesión con email
- Registro de usuarios
- Recuperación de contraseña
- Perfil de usuario
- Nombre, correo y teléfono asociados a reservaciones

### WhatsApp

Integración independiente para comunicación automática con clientes.

- Aviso de reserva pendiente
- Confirmación de reserva
- Generación de PDF
- Envío de confirmación directamente al cliente
- Integración con los cambios de estado realizados desde Admin

### Standings

Leaderboard conectado con los resultados de Inercia.

- Resultados sincronizados desde Google Sheets
- Clasificación por tiempo
- Filtros por categoría
- Filtro por género
- Equipos
- Identificación de pilotos Team Inercia
- Indicadores `(T)` y `(S)`
- Circuito y mapa correspondiente al evento
- Sección **Mi Tiempo** vinculada con el usuario autenticado

---

## ADMIN PANEL

El panel administrativo centraliza las operaciones internas de Inercia.

### Reservas

Visualización y administración de las reservaciones del negocio.

- Calendario de reservas
- Reservas pendientes
- Reservas aprobadas
- Creación manual de reservas
- Selección de simuladores
- Cliente y teléfono
- Método de pago
- Duración
- Total automático

### Rigs

Administración del inventario de simuladores.

- Crear rigs
- Eliminar rigs
- Standard / Premium
- Activar y desactivar
- Estado de mantenimiento
- Precio por hora

### Ventas

Sistema interno para registrar y consultar ingresos.

- Ventas provenientes de reservas
- Ventas manuales
- Productos preestablecidos
- Métodos de pago
- Transacciones
- Promedio de venta
- Filtros por semana, mes y año

### Lockdowns

El administrador puede cerrar disponibilidad sin modificar los horarios normales.

```text
Fecha: 27/08/2026
Desde: 15:00
Hasta: 18:00
Motivo: Evento privado
```

El sistema bloquea cualquier reserva que tenga conflicto con ese intervalo.

```text
14:00 → 15:00    ✓
14:00 → 16:00    ✕
15:00 → 16:00    ✕
17:00 → 19:00    ✕
18:00 → 19:00    ✓
```

---

## SIMULADORES

| Tipo | Tarifa base |
| :--- | ---: |
| Standard | L 200 / hora |
| Premium | L 350 / hora |

Los precios pueden modificarse desde el panel administrativo.

---

## STACK

<div align="center">

![HTML](https://img.shields.io/badge/HTML5-111111?style=for-the-badge&logo=html5)
![CSS](https://img.shields.io/badge/CSS3-111111?style=for-the-badge&logo=css)
![JavaScript](https://img.shields.io/badge/JavaScript-111111?style=for-the-badge&logo=javascript)
![Vite](https://img.shields.io/badge/Vite-111111?style=for-the-badge&logo=vite)
![Firebase](https://img.shields.io/badge/Firebase-111111?style=for-the-badge&logo=firebase)
![Vercel](https://img.shields.io/badge/Vercel-111111?style=for-the-badge&logo=vercel)
![PayPal](https://img.shields.io/badge/PayPal-111111?style=for-the-badge&logo=paypal)

</div>

### Frontend

```text
HTML
CSS
JavaScript
Vite
```

### Backend

```text
Vercel Serverless Functions
Node.js
Firebase Admin SDK
```

### Infrastructure

```text
Firebase Authentication
Cloud Firestore
Firebase Storage
Vercel
```

### Integraciones

```text
PayPal REST API
Google Sheets
WhatsApp
```

---

## ESTRUCTURA

```text
Inercia/
│
├── api/
│   ├── reservations/
│   ├── paypal/
│   └── _lib/
│
├── assets/
├── css/
├── fonts/
├── js/
│
├── public/
│   └── data/
│       └── tracks.json
│
├── index.html
├── contacto.html
├── firebase-config.js
├── package.json
├── vercel.json
└── README.md
```

---

## 💳 FLUJO PAYPAL

```text
Usuario selecciona fecha y rigs
              │
              ▼
      Validar disponibilidad
              │
              ▼
 Crear reserva payment_pending
              │
              ▼
     Bloquear slots elegidos
              │
              ▼
        PayPal Checkout
          │         │
       SUCCESS    CANCEL
          │         │
          ▼         ▼
      CAPTURE    Liberar rigs
          │
          ▼
       APPROVED
          │
          ▼
 Registrar venta + confirmación
```

---

## FIRESTORE

Colecciones principales:

```text
users/
reservations/
reservationLocks/
rigs/
products/
availabilityLockdowns/
settings/
```

La disponibilidad utiliza locks individuales para impedir que dos clientes reserven el mismo simulador durante el mismo período.

---

## 🌐 PRODUCCIÓN

La plataforma está desplegada utilizando **Vercel**.

### Sitio oficial

**[inerciahn.com](https://inerciahn.com)**

---

## IDENTIDAD

```text
ORANGE     #FF8B00
BLACK      #0A0A0A
DARK       #111111
WHITE      #F5F5F5
```

La interfaz está diseñada alrededor de una estética inspirada en motorsport: tipografía condensada, alto contraste y uso limitado del naranja como color de acción.

---

## PROJECT STATUS

```text
WEBSITE             ██████████  ONLINE
AUTH                ██████████  ONLINE
RESERVATIONS        ██████████  ONLINE
ADMIN               ██████████  ONLINE
PAYPAL              ██████████  ONLINE
STANDINGS           ██████████  ONLINE
WHATSAPP             ██████████  ONLINE
```

El proyecto continúa en desarrollo activo.

---

<div align="center">

<img src="assets/readme/inercia-logo.png" alt="Simuladores Inercia" width="180">
<br>


</div>