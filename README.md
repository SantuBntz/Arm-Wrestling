# Arm Wrestling

Pulseada 1 contra 1 con quick time event, en 3D low poly. Cada jugador tiene su propia flecha:
clickeá cuando pase por la zona amarilla. Cada acierto acelera tu flecha; gana quien acierte más.

## Flujo
1. Menú: creá una sala o unite con el código.
2. Cinemática: los dos personajes entran, corren la silla y se sientan a la mesa (botón Saltar).
3. Cada jugador escribe su nombre y toca ¡Listo!.
4. Cuando los dos están listos, juntan las manos, cuenta regresiva y arranca la pulseada.

## Jugar en tu red local
    npm install
    npm start
Abrí http://localhost:3000 en dos pestañas o en dos PCs de la misma red.

## Jugar por internet (cloudflared)
1. `winget install Cloudflare.cloudflared` (una sola vez, después reabrí la terminal).
2. `npm run online` (o doble click en `jugar-online.bat`).
3. Abrí el link `https://....trycloudflare.com`, creá la sala y pasale el link a tu rival.

## Controles
- Click o barra espaciadora: pulsar
- C: primera persona / vista desde atrás
- M: silenciar

## Ajustes
La dificultad está en el objeto `CONFIG` de `server.js`. Los personajes (`STYLES`) y la cinemática
(`stage()`) están en `public/index.html`. Three.js (MIT) viene incluido en `public/vendor`.
