# Trabajo real que se queda en el árbol de trabajo y nunca llega al repositorio

## Lo que se encontró, 2026-10-25

José confirmó que solo nosotros trabajamos en `hermes-factory-webui` y que
cualquier cosa sin commitear es un resto abandonado, no trabajo ajeno en
curso. Al revisarlo antes de descartarlo: **el último commit real en la
rama `feat/ui-redesign-hierarchical-nav` es del 2026-10-18.** El trabajo sin
commitear —el arreglo del tope de bots (12→32), el soporte multi-tablero, la
política de enrutamiento, el catálogo de precios, una docena de ficheros de
prueba nuevos, ~240 KB de documentación y ~620 KB de evidencia— se hizo el
**2026-10-24**. Siete días de trabajo real, sustancial, nunca commiteado.

No es un descuido aislado: es prácticamente **todo** el trabajo de una
sesión completa, incluido el propio `acceptance.json` que este mismo
proyecto usa como referencia de aceptación. El informe que describía el
tope de 12 bots como "bloqueante" estaba describiendo con precisión el
código *commiteado* — el código *real*, en el árbol de trabajo, ya no tenía
ese límite. El informe no estaba mal escrito: estaba describiendo un
repositorio que no reflejaba lo que de verdad corría.

## Por qué importa más que "faltó un commit"

- **Es una fuga, no un retraso.** Un `git checkout --` descuidado, un `git
  stash` olvidado, o simplemente otra persona clonando el repositorio en
  vez de copiar el árbol de trabajo, pierde siete días de trabajo real sin
  ningún aviso.
- **El repositorio deja de ser la fuente de verdad sobre lo que corre.**
  Cualquiera que lea el repositorio —incluido un informe de aceptación que
  se apoya en "leer el código"— lee una versión más vieja que la real, y no
  tiene forma de saberlo sin comparar fechas de modificación a mano, que es
  exactamente lo que hizo falta hacer hoy para encontrar esto.
- **Combina mal con la lección de `acceptance.json`**: ya sabíamos que el
  informe podía estar desactualizado respecto al código. Esto añade que el
  propio *repositorio* puede estar desactualizado respecto al árbol de
  trabajo real — son dos capas de la misma deriva, no una.

## Qué se hizo hoy (contención, no corrección de la causa)

Se recuperó todo en 5 commits separados, cada uno describiéndose como
recuperación de trabajo sin commitear del 24-10, con el ruido obvio (dos
ficheros temporales de 0 bytes) descartado antes. La corrección propia del
25-10 sobre `acceptance.json` quedó en su propio commit, sin mezclarse.

## Lo que no se resolvió, y que merece decidirse aparte

No se investigó **por qué** este repositorio en particular lleva sin
commits regulares, ni si el hábito es "trabajar varios días y commitear al
final" (que no sería un defecto en sí, solo un riesgo mientras no haya
commit) o si simplemente nadie lo recordó. Tampoco se instaló ningún
recordatorio automático (un hook de pre-commit, un cron que avise de
working trees con muchos días de antigüedad sin commit) — sería la misma
decisión que ya se tomó para el detector de deriva de `acceptance.json`:
antes de construir algo, vale la pena saber si esto es un patrón del
equipo que trabaja en ese repositorio, o un incidente aislado que ya no se
va a repetir porque ahora se sabe que no hay nadie más revisando ese árbol.
