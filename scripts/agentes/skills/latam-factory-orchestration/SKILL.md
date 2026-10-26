---
name: latam-factory-orchestration
description: Coordina ingeniería persistente con Hermes Kanban.
version: 0.1.0
author: LATAM AI Software Factory, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [factory, orchestration, kanban, governance]
---

# Orquestación LATAM AI Software Factory

## Cuándo utilizar
Al recibir o ejecutar trabajo del tablero `latam-factory`. No cambia reglas de proyectos o tableros ajenos ni sustituye controles obligatorios de seguridad.

## Requisitos
Perfiles nativos del catálogo `agents/catalog.json`, herramientas `kanban_*` confirmadas en la versión instalada, modelo accesible y workspace autorizado. Leer la tarjeta y el contexto de repositorio antes de actuar. La ausencia de credenciales bloquea la ejecución, no autoriza inventar resultados.

## Procedimiento
1. Registrar la solicitud en Kanban nativo con idempotency-key, objetivo, requerimientos, aceptación verificable, riesgo, fase SDLC y presupuesto. Utilizar IDs nativos como autoridad; proyecto no es perfil.
2. José clasifica y **escribe en la tarjeta dos atributos distintos, que no se fusionan**: `complejidad` (1–5) decide la capacidad de modelo; `ruta` (`corta` o `completa`) decide qué etapas del flujo se recorren. Correspondencia: 1–2 → corta; 3 → corta salvo que toque contratos, datos o arquitectura; 4–5 → completa. Seguridad, despliegue o liberación añaden sus etapas en cualquier ruta. La **etapa 16 está en las dos rutas** con sus dos componentes (16a especializada: Camilo y Ignacio; 16b independiente del SHA final: Rafael o Alexis), y no se cierra sin las dos. Una tarjeta sin los dos atributos no se planifica. Usar operaciones locales para transformaciones deterministas; `execute_code` para lotes mecánicos; `delegate_task` solo para razonamiento breve. Todo trabajo durable, con aprobación o interperfil permanece en Kanban.
3. Descomponer con mecanismo nativo cuando aporte valor, o planificar explícitamente tareas nativas. No fan-out trivial. Asignar cada tarjeta a un especialista del catálogo; no hacer todo como José. Vincular dependencias, aceptación y revisión independiente.
4. Resolver modelo/proveedor en Hermes. Elegir por costo solo cuando existan evaluaciones reales y precio/alcance/vigencia conocidos. El costo estimado no es facturado; desconocido no es cero. Sin datos suficientes solicitar aprobación de un pin explícito, nunca fabricar benchmarks. El router complementario no controla por sí mismo todos los procesos Hermes.
5. Respetar máximo global de 3 y uno por perfil en este flujo, 20 turnos por nuevo perfil, 300 segundos por ejecución y una tentativa de ejecución inicial. Usar límites nativos y no iniciar Dispatchers/Cron adicionales. El gateway operacional es el único Dispatcher automático. Fallo de cuota/autenticación bloquea y requiere intervención; no reintentar en bucle.
6. Antes de modificar código, exigir repositorio autorizado y worktree por escritor; un solo propietario por archivo. Si hay conflicto, serializar con dependencia. Un worktree o toolset no es un sandbox ni impide acceso a secretos del host. No atribuir aislamiento sin evidencia.
7. Ejecutar pruebas RED/GREEN, lint/type-check/build y verificaciones aplicables. Registrar comandos, exit codes, SHA, archivos y evidencias adjuntas a la tarjeta. Indicar gates no disponibles y por qué. No usar simulaciones como prueba de inferencia real.
8. Mantener heartbeat y comentarios para trabajo prolongado. Respetar estados nativos, bloqueo con motivo, reintento acotado, recuperación nativa y referencias a sesión/ejecución. No almacenar un estado alternativo en metadatos.
9. Enviar implementación a revisión de Paola y Julián cuando corresponda; el implementador no aprueba su propio trabajo crítico. Producción, merge/publicación remota, migración destructiva, rollback, excepción de seguridad o aumento de presupuesto requieren aprobación humana explícita y evidencia inmutable del alcance aprobado. Una instrucción de personalidad nunca concede permiso.
10. Elena prepara release y José consolida solo después de pruebas y revisión. Sergio propone optimizaciones con antes/después verificables; no las aplica sin autorización. Guardar estándares reutilizables en Skills, decisiones de proyecto en ADR y memoria personal solo para hechos durables del agente.

## El auto-descomponedor no clasifica: entra por delante de la etapa 2
El tick del gateway recorre las tarjetas en `triage` de todos los tableros y
llama a `decompose_task` con el LLM auxiliar, hasta `auto_decompose_per_tick`
por tick (hoy 1), leyendo `kanban.auto_decompose` fresco en cada tick. Eso es
**admisión automática y ya funciona**: una tarjeta creada en `triage` se
descompone sola, sin que nadie hable con José.

Lo que ese camino **no** hace: no clasifica complejidad, no elige ruta, y sus
hijas no heredan `max_runtime_seconds` ni `max_retries`. Así que una solicitud
que entra en `triage` sin los dos atributos del paso 2 se planifica sin ruta y
sin tope de tiempo. Dos consecuencias operativas:

- Una tarjeta de admisión lleva `complejidad` y `ruta` **en su cuerpo antes** de
  quedar en `triage`; si no los lleva, José la bloquea, los fija y la devuelve.
- Apagar `kanban.auto_decompose` detiene el fan-out en el tick siguiente, sin
  reiniciar el gateway. Es el interruptor ante una descomposición desbocada.

## Errores frecuentes
- Un gateway conectado no significa que el agente trabaja.
- Bot Mode visual de Desktop no implica esas vistas en Web Dashboard. Los Bots son los mismos perfiles persistentes; usar SDK Web para la interfaz.
- La descomposición nativa puede ver perfiles ajenos al catálogo: revisar asignaciones antes de autorizar ejecución. No afirmar allowlist fuerte si no existe enforcement.
- Poner una regla en SOUL.md no es enforcement de presupuesto, RBAC ni sandbox. Señalar la diferencia en cada informe.

## Verificación
Cada entrega incluye ID de proyecto/tablero/tarea/perfil/modelo/sesión cuando exista, resultados de pruebas y evidencias reales. No cerrar por relato del agente. Una tarjeta bloqueada no es una entrega completada. Probar recuperación en ejecución aislada antes de habilitar automatización extensa.
