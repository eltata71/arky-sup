# Plan maestro — seis fases

**Premisa.** La aplicación queda operativa en todo momento. No entran
microservicios, backend de dominio propio, broker, event sourcing ni CQRS
completo. Se conservan React, Vite, TypeScript, Supabase (Auth, PostgreSQL con
RLS y RPC, Storage), el proxy de IA y el despliegue por `ci.yml`.

**Regla que ordena las fases.** El repositorio ya tiene fronteras *declaradas*
y un gate que las defiende. Lo que no tiene es (a) reglas de negocio aplicadas
donde son autoridad —el servidor— y (b) fronteras que resistan una lectura
transitiva. Por eso **la consistencia va antes que la estética**: mover ficheros
sobre invariantes que nadie aplica es reordenar un edificio sin cimientos.

---

## Fase 1 — Modelo de dominio y línea base  ▸ *en curso*

**Objetivo.** Saber exactamente dónde estamos, qué reglas existen y quién las
aplica, y dejar un backlog ejecutable.

**Cierre.** Línea base reproducible con comandos; los doce hallazgos
clasificados con evidencia; cada invariante crítica con dueño y autoridad de
validación; decisiones pendientes separadas de supuestos; backlog de las seis
fases escrito.

## Fase 2 — Consistencia y gobernanza

**Objetivo.** Que ninguna regla que importa dependa de que el navegador se
porte bien.

Se ataca: H01, H02, H05 (parcialmente), H06, H07, H08, H09, H10.

**Cierre.** Un fallo no deja un encargo entregado sin decisión; el autor no se
autoaprueba cuando la política lo exige; las RPC rechazan transiciones ilegales;
no se ejecuta un charter sin aprobar aunque se llame al runner directamente; dos
intentos concurrentes no duplican efectos; no quedan referencias inválidas por
borrado; las RPC retiradas dejan de ser invocables; un fallo de persistencia no
se comunica como éxito.

**Restricción conocida.** Los contratos pgTAP no se pueden ejecutar en este
entorno (sin Docker, sin CLI de Supabase). Se escriben con su caso negativo y su
ejecución queda en `.github/workflows/supabase.yml`. Ninguna afirmación sobre
comportamiento SQL se declarará validada hasta que ese workflow pase.

## Fase 3 — Fronteras y contexto piloto

**Objetivo.** Que el gate mida lo que dice medir, y que un contexto enseñe el
patrón.

Se ataca: H03, H04, H12 (primera mitad).

**Cierre.** El detector encuentra ciclos de tres o más módulos; las reglas de
Iniciativas se prueban sin React ni Supabase; sus consumidores no tocan
infraestructura interna; el presupuesto de excepciones no sube; el de descarga
no empeora; queda un patrón documentado y replicable.

## Fase 4 — Proyectos y Entregables

**Objetivo.** Decidir la frontera Proyecto–Artefacto por invariantes, no por
costumbre, y sacar la coordinación de React.

Se ataca: H05 (resto), el fan-out de las diez pantallas.

**Cierre.** La frontera justificada por ADR; concurrencia explícita y probada;
editar un artefacto no sobrescribe cambios independientes; versionado y
publicación fuera de React; migraciones con compatibilidad y reversión.

## Fase 5 — Oficina, IA y proyecciones

**Objetivo.** Deshacer el componente conexo de nueve módulos y dar recuperación
durable a lo que la necesita.

Se ataca: H11, H12 (resto), las 22 aristas internas del SCC.

**Cierre.** El núcleo de IA no depende de implementaciones de negocio; cada
extracción conserva contratos; los ciclos entre contextos bajan hasta
desaparecer; las proyecciones pendientes son observables y recuperables;
reprocesar un evento no duplica efectos.

## Fase 6 — Consolidación y cierre

**Cierre.** Cero ciclos entre contextos de negocio (leídos transitivamente);
cero accesos externos a implementaciones internas; toda tabla, RPC e invariante
con propietario; el dominio probado sin infraestructura ni UI; invariantes
críticas en servidor; decisiones ARB atómicas y auditables; conflictos
concurrentes explícitos y recuperables; proyecciones durables idempotentes;
gates de calidad y rendimiento en verde; informe técnico y gerencial.
