# Microinteracciones con propósito (13.5)

Un vocabulario corto, declarado en `lib/designTokens.ts` (`MICRO`, `MICRO_EVENTS`) y aplicado por
`components/ui/micro/`. Cada animación responde a algo que **ocurrió en el trabajo**; ninguna se
reproduce porque sí, ninguna se repite y todas se apagan con movimiento reducido.

| Microinteracción | Forma | Evento de dominio que la justifica | Dónde |
|---|---|---|---|
| **Aparecer** | fundido y 8 px hacia arriba, 180 ms, una vez al montarse | contenido que llega a una lista o a un panel | centro de generaciones (cada trabajo) |
| **Completar** | una marca que se dibuja, 400 ms | **generación terminada**; **charter aprobado** | centro de generaciones (estado «Listo»); sala del entregable (charter) |
| **Reordenar** | las filas se deslizan a su nuevo sitio | el portafolio cambia de orden porque cambiaron los datos | tablero (riesgo y atención); centro de generaciones |
| **Celebrar una vez** | un anillo que se expande y se desvanece junto a una frase | **paquete publicado** | centro de publicación |

## Las reglas

- **Un hecho no es un evento.** `CompletionMark` sólo dibuja la marca cuando el estado pasa a
  hecho *mientras la pantalla está abierta* (`useJustHappened`). Un charter que ya estaba aprobado
  al abrir la sala se muestra con la marca quieta: animarlo en cada visita celebraría lo mismo cada
  vez que alguien mira.
- **Celebrar es una vez por paquete.** `CelebrateOnce` recuerda en este navegador los paquetes ya
  celebrados (`arky.celebrated.v1`), y el centro de publicación sólo la dispara desde una
  publicación que terminó bien en ese momento, nunca al abrir un paquete ya publicado. No hay
  confeti.
- **Nada en bucle salvo el progreso.** Las únicas animaciones con `repeat: Infinity` son
  indicadores de trabajo en curso (esqueleto de diagrama, identidad del agente mientras trabaja,
  panel de coordinación, carga de la pizarra). `__tests__/motion/microinteractions.test.tsx` tiene
  esa lista y sólo puede encoger.
- **Movimiento reducido.** La raíz envuelve la aplicación en `MotionConfig reducedMotion="user"`, y
  además los componentes de `components/ui/micro/` comprueban la preferencia y pintan el estado
  final sin animar: la información es la misma.
- **Ninguna duración literal.** Las cuatro salen de `MICRO`; `motionTokens.test.ts` rechaza un
  `duration:` escrito a mano en un componente.
