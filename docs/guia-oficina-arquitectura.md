# Guía práctica — Gestionar proyectos con la Oficina de Arquitectura

Guía de uso, no de implementación. El contrato técnico está en
`docs/oficina-arquitectura.md`.

---

## Qué cambia respecto a antes

| Antes | Ahora |
|---|---|
| Creabas el proyecto y luego elegías plantillas una por una | Describes la necesidad de negocio y la Oficina propone el plan completo |
| Generabas cada artefacto y lo revisabas tú mismo | Un especialista produce cada entregable y **otro distinto** lo revisa |
| Aprobabas artefacto por artefacto | Decides en dos momentos: el **charter** al inicio y el **comité (ARB)** al final |
| El trabajo moría con la pestaña | Cada transición se persiste; recargar reanuda el encargo |

El modo anterior no desaparece: `/projects` conserva las tarjetas de creación
directa bajo **"Modo directo"** para trabajo puntual.

---

## El flujo, en cinco pasos

### 1 · Abrir el encargo — `/office` → **Nuevo encargo**

Tres campos:

- **Proyecto de destino** — uno existente, o *"Abrir un proyecto nuevo para
  este encargo"*. Ya no necesitas crear el proyecto antes: la Oficina lo abre
  con el título y el brief que escribas.
- **Título del encargo** — el nombre corto por el que lo vas a buscar.
- **¿Qué necesita el negocio?** — el brief. Es lo único que determina el plan.
- **Proyecto de negocio** (opcional) — `NEG-2026-001`, para trazabilidad.

**Cómo escribir el brief.** De él salen el tipo de encargo, los entregables,
los especialistas y los marcos regulatorios. Nombra explícitamente:

- el **sistema** (AS/400, core de pólizas, portal de agentes…),
- la **integración** (MuleSoft, Salesforce, APIs…),
- el **dominio asegurador** (siniestros, suscripción, reservas actuariales…),
- la **regulación** (HIPAA, Solvencia II, NAIC, DORA, ISO 27001…).

> *"Modernizar el motor de siniestros AS/400 exponiendo APIs a Salesforce
> Health Cloud, cumpliendo HIPAA y con trazabilidad regulatoria."*

Ese brief activa a Ricardo (AS/400), Mauricio (integración), Natalia
(Salesforce), Sofía (core de seguros) y Carmen (cumplimiento).

### 2 · Revisar el charter — tu primera decisión

La Oficina responde con un plan: objetivos, alcance, fuera de alcance,
entregables con **quién produce** y **quién revisa** cada uno, dependencias
entre ellos y marcos regulatorios aplicables.

Qué mirar antes de aprobar:

- ¿Están los entregables que necesitas? ¿Sobra alguno?
- ¿Las asignaciones tienen sentido para tu organización?
- ¿Aparecen los marcos regulatorios que aplican al caso?

La insignia **"Plan determinista"** o **"Plan refinado con IA"** te dice cómo
se armó. Si la IA no estaba disponible, el plan determinista igual es
ejecutable — pierdes matiz, no el encargo.

Dos salidas: **Guardar sin ejecutar** (queda en la bandeja para decidir luego)
o **Aprobar charter y ejecutar**.

### 3 · Dejar trabajar a la Oficina

Al aprobar, el ejecutor recorre el DAG: produce lo que no tiene dependencias
pendientes, manda cada entregable a su revisor y solo entonces libera lo que
dependía de él. En la sala del encargo (`/office/:id`) ves el tablero por
estado y la bitácora.

Reglas que gobiernan la ejecución:

- **El revisor nunca es el productor.**
- Un veredicto de *cambios solicitados* **re-encola la producción una vez**,
  con los hallazgos incorporados. A los dos intentos se detiene y queda visible.
- Los **validadores deterministas mandan sobre la IA**: si un contrato está
  roto, el entregable no se aprueba aunque el modelo diga que sí.
- El presupuesto de llamadas corta la operación antes de dispararse.

⚠️ **La Oficina corre en tu navegador.** Si cierras la pestaña, el encargo se
detiene donde iba; al volver, reanuda desde la última tarea completada. Déjala
abierta mientras ejecuta.

### 4 · Leer los quality gates

Cada gate trae **bloqueantes**, **condiciones** y los **artefactos de
evidencia** que lo sustentan. No es un semáforo decorativo: un gate en
`blocked` impide la aprobación del comité.

Si un gate te sorprende, abre su evidencia: te lleva al artefacto concreto que
lo motivó.

### 5 · El comité (ARB) — tu segunda decisión

Con el encargo en `awaiting-arb`:

- **Aprobar** — solo si ningún gate está `blocked`. Si hay entregables
  fallidos, se exige justificación explícita.
- **Solicitar cambios** / **Rechazar** — el motivo es obligatorio.

La decisión es **inmutable**: queda con actor, fecha, motivo y el estado antes
y después. No se edita ni se borra.

**Requiere rol `admin` o `superadmin`.** Es separación de funciones a
propósito: quien ejecuta el encargo no es quien lo da por entregado. Si no
tienes el rol, la acción aparece como *"requiere un administrador"*.

Un encargo entregado puede sembrar un paquete en el **Centro de Publicación**
con sus artefactos y su bitácora.

---

## El panel de la Oficina — `/office`

Responde tres preguntas de un vistazo:

1. **Requieren tu decisión** — charters por aprobar, encargos en comité,
   bloqueos. Empieza siempre por aquí.
2. **Encargos** — avance del DAG, estado de gates, retrasos.
3. **Carga de los especialistas** — quién está ocupado y con qué.

---

## Los 13 especialistas

| Ámbito | Especialistas |
|---|---|
| Coordinación y consolidación | Lucía (coordina), Alejandro (arquitecto empresarial jefe, consolida) |
| Generalista | Arky (arquitecto agente) |
| Plataforma e integración | Felipe (AWS), Mauricio (MuleSoft), Ricardo (AS/400), Natalia (Salesforce) |
| Software y artefactos | Gabriel (arquitectura de software), Elena (artefactos: C4, ADR, OpenAPI, STRIDE) |
| Gestión | Tomás (administración de proyectos) |
| Seguros | Sofía (core: pólizas, siniestros, ACORD), Daniel (datos y analítica, PII/PHI), Carmen (riesgo y cumplimiento) |

*(Esta tabla nombraba antes a cuatro especialistas que no existen en el
producto — Andrés, Paula, Javier y Marcela. La lista de arriba es la que
`/agents` muestra de verdad.)*

No los eliges para un encargo: el enrutador los asigna por tipo de entregable y
por las señales del brief. Un brief más concreto produce un reparto mejor.

### Su ficha — `/agents`

Cada agente tiene una ficha que puedes abrir y ajustar a tu organización:

- **Cómo se llama y cómo se ve** — nombre y un avatar (uno o dos emoji).
- **Qué sabe** — habilidades y conocimiento de tu compañía. Se **suman** a lo
  que ya sabe: enseñarle a Sofía tu canal de corredores no le hace olvidar
  ACORD.
- **Qué recuerda** — la memoria que arrastra a cada respuesta: decisiones ya
  tomadas, convenciones, vetos del comité.
- **Con qué modelo trabaja** — rápido, estándar o de razonamiento — y cuántas
  tareas puede llevar a la vez.
- **Si está disponible** — un agente desactivado no se convoca. No se borra:
  los encargos que ya lo nombran deben seguir siendo legibles.

Lo que **no** se puede cambiar desde la ficha, a propósito: qué artefactos
produce cada uno, cuáles revisa y su papel en la orquestación. Si desde un
formulario se pudiera hacer que el mismo agente produjera y revisara su propio
artefacto, la revisión dejaría de significar nada — y esa separación es la razón
de ser de una oficina de arquitectura.

Lo que escribas en la ficha viaja en todos los prompts de ese agente: en la
ayuda de los formularios y en las respuestas del equipo.

---

## El asistente que completa formularios

Al lado de cada campo de una iniciativa, un proyecto o una solicitud de
entregable hay un botón **✨ IA**, y arriba del formulario uno que dice
**«Completar con el asistente»**. Hacen lo mismo a distinta escala: proponen
cómo rellenar lo que falta, a partir de lo que el registro ya dice.

Tres cosas que conviene saber:

1. **Nada se escribe solo.** La propuesta se ve y se acepta con un clic; en las
   listas, entrada a entrada. Lo que no aceptes, se descarta.
2. **Responde un solo agente, no el equipo.** Redactar un objetivo no necesita
   coordinadora, especialistas y consolidador: necesita un arquitecto. El equipo
   completo sigue estando a un clic, en «Equipo de arquitectura», que es donde
   una pregunta de arquitectura lo merece.
3. **Si no hay de dónde partir, te lo dice en vez de inventar.** Con la ficha en
   blanco el botón está desactivado y explica qué escribir primero. Y lo que no
   puede deducir aparece como **preguntas para el negocio**, no como un campo
   rellenado a la ligera.

En los indicadores, los hitos, los riesgos y las personas la propuesta rellena
la *fila de añadir*: la unidad, la fecha o el nivel los pones tú. El asistente
redacta; quien confirma, firma.

Dos textos no se tocan nunca porque son el registro de lo que pidió el negocio:
la **necesidad** de una iniciativa una vez creada y el **brief** de un
entregable. Si el encargo cambia, se abre otro.

---

## Problemas frecuentes

| Síntoma | Causa y salida |
|---|---|
| El plan asigna mal los entregables | El brief es genérico. Nombra sistema, integración, dominio y regulación. |
| El botón ✨ IA está desactivado | Todavía no hay de dónde partir. Escribe la necesidad (iniciativa), el nombre y el objetivo (proyecto) o el título y el brief (entregable). |
| El asistente propone algo genérico | Le falta contexto: completa la necesidad del negocio o el contexto del proyecto y vuelve a pedírselo. Propone a partir del registro, no desde cero. |
| Cambié la ficha de un agente y no noto nada | La ficha viaja en sus prompts, no en su reparto de artefactos. Si esperabas que produjera otro tipo de artefacto, eso es gobierno y no se configura. |
| "Requiere un administrador" en el comité | Tu usuario no tiene claim `admin`/`superadmin`. Ver `docs/security-hardening.md`. |
| El encargo no sobrevive a una recarga | Faltan las reglas de Firestore: `npm run deploy:rules`. |
| Una tarea quedó en *cambios solicitados* | Agotó sus dos intentos. Abre los hallazgos, corrige el artefacto a mano y vuelve a lanzar. |
| El comité no deja aprobar | Hay un gate en `blocked`. Es el comportamiento correcto: resuelve el bloqueante primero. |

---

## Requisitos de despliegue

1. **Reglas de Firestore** — `npm run deploy:rules` (con el `projectId` real en
   `.firebaserc`). Sin ellas, los encargos no persisten.
2. **Claims de rol** — al menos un usuario con `admin`/`superadmin` para que el
   comité pueda decidir. Ver `docs/security-hardening.md`.
