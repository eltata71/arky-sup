# Crear el primer administrador de Arky

> **Para quién es esta guía:** la persona que va a poner Arky en marcha. **No
> hace falta saber programar** ni instalar nada. Todo se hace con clics en la
> consola de Firebase, entrando con tu cuenta de Google.
>
> **Cuánto toma:** unos 5 minutos, una sola vez en la vida del sistema.

---

## Por qué hay que hacer esto una vez

En Arky **nadie puede crearse su propia cuenta**. Las cuentas las crea un
administrador desde la pantalla de *Seguridad*. Eso es exactamente lo que
querías, y tiene una consecuencia: **la primera cuenta no puede crearse desde
Arky**, porque todavía no hay ningún administrador que la cree.

Es el problema del primer huevo. Se resuelve creando esa primera cuenta
directamente en Firebase, que es la base de datos donde Arky guarda todo. A
partir de ahí, **todas las demás cuentas se crean dentro de Arky**, con un
formulario normal, y nunca más vuelves aquí.

---

## Lo que necesitas antes de empezar

- Tu cuenta de Google, la misma con la que se creó el proyecto de Firebase.
- Saber **el nombre del proyecto** en Firebase (si no lo sabes, al entrar verás
  la lista y normalmente hay uno solo).
- El correo que quieres usar para tu cuenta de Arky.

---

## Paso 1 · Entra a la consola de Firebase

1. Abre **https://console.firebase.google.com** en tu navegador.
2. Entra con tu cuenta de Google si te lo pide.
3. Haz clic en el proyecto de Arky.

---

## Paso 2 · Crea tu usuario

Esto crea tu *identidad*: el correo y la contraseña con los que vas a entrar.

1. En el menú de la izquierda busca **Compilación** (o *Build*) y haz clic en
   **Authentication**.
2. Entra a la pestaña **Users** (Usuarios).
3. Pulsa el botón **Agregar usuario** (*Add user*).
4. Escribe:
   - **Correo electrónico:** el tuyo.
   - **Contraseña:** una contraseña larga y que no uses en otro sitio. La vas a
     usar para entrar a Arky; después puedes cambiarla desde
     *Ajustes → Cuenta* dentro de la aplicación.
5. Pulsa **Agregar usuario**.

> **Si el botón no aparece o da error:** hay que habilitar el método de acceso.
> Ve a la pestaña **Sign-in method**, elige **Correo electrónico/Contraseña**,
> actívalo y guarda. Luego vuelve a este paso.

### Copia el identificador

En la lista de usuarios aparece ahora tu correo y, en la columna de la derecha,
una **UID de usuario**: una tira larga de letras y números, algo como
`kJ8mQ2xPvRcT4nB7wZ...`.

**Cópiala.** Hay un icono para copiarla al pasar el ratón por encima. La vas a
pegar en el paso siguiente, y tiene que quedar **idéntica** — no la escribas a
mano.

---

## Paso 3 · Crea tu perfil

El paso anterior creó tu identidad. Este crea tu **cuenta dentro de Arky**, que
es donde vive tu rol.

1. En el menú de la izquierda, dentro de **Compilación**, haz clic en
   **Firestore Database**.
2. Vas a crear un documento. Hay dos casos:
   - **Si ya ves una colección llamada `users`** en la primera columna: haz clic
     en ella y luego en **Agregar documento**.
   - **Si la base de datos está vacía:** pulsa **Iniciar colección**
     (*Start collection*) y escribe como ID de la colección exactamente:
     ```
     users
     ```
     (todo en minúsculas, sin acentos, sin espacios) y continúa.
3. En **ID del documento**, **pega la UID** que copiaste en el paso 2.
   No pulses «ID automático»: tiene que ser exactamente esa UID.
4. Ahora añade **cuatro campos**. Para cada uno pulsa *Agregar campo* y llena
   las tres casillas así:

   | Campo (*Field*) | Tipo (*Type*) | Valor (*Value*) |
   | --------------- | ------------- | --------------- |
   | `uid`           | string        | *la misma UID que pegaste arriba* |
   | `email`         | string        | tu correo |
   | `displayName`   | string        | tu nombre, como quieres que se vea |
   | `role`          | string        | `superadmin` |

   > Los nombres de los campos van **tal cual**, en minúsculas y sin acentos.
   > `displayName` lleva esa N mayúscula en medio. El tipo es **string** en los
   > cuatro.

5. Pulsa **Guardar**.

---

## Paso 4 · Comprueba que funcionó

1. Abre Arky.
2. Entra con el correo y la contraseña del paso 2.
3. En la barra lateral izquierda debe aparecer **Seguridad** al final. Ese es el
   panel de gestión de usuarios, y solo lo ven los administradores.

Si lo ves, terminaste. **No vuelvas a la consola de Firebase.**

---

## Paso 5 · Crea a las demás personas desde Arky

Ya dentro de la aplicación:

1. Barra lateral → **Seguridad**.
2. Botón **Crear cuenta**.
3. Escribe el nombre, el correo y elige el rol.
4. Pulsa **Crear e invitar**.

**Tú no eliges la contraseña de nadie.** La persona recibe un correo para poner
la suya. Si no le llega, en su fila hay un botón con un sobre para reenviar la
invitación.

### Qué rol darle a cada quien

| Rol | Para quién |
| --- | --- |
| **Observador** | Alguien que solo necesita mirar el portafolio y hacer cursos. No modifica nada. |
| **Arquitecto** | El rol de trabajo normal: crea iniciativas, atenciones, entregables y artefactos. |
| **Revisor** | Un arquitecto que además aprueba, decide en el comité y publica. |
| **Formador** | Quien arma los cursos del Centro de Transformación. |
| **Administrador** | Además de todo lo anterior, crea y gestiona cuentas. |
| **Superadministrador** | Todo, incluido nombrar a otros administradores. |

En la duda, **Arquitecto**. Siempre se puede cambiar después.

---

## Si algo no sale

| Lo que ves | Qué pasó | Cómo se arregla |
| --- | --- | --- |
| «Tu identidad es válida pero no tiene una cuenta en Arky» | Entraste bien, pero el perfil del paso 3 no está o su ID no coincide con la UID. | Vuelve al paso 3 y compara letra por letra el **ID del documento** con la **UID del usuario**. Es el error más común. |
| Entras, pero **no ves «Seguridad»** en la barra lateral | El campo `role` no dice exactamente `superadmin`. | Revisa que esté escrito en minúsculas, sin espacios delante ni detrás, y que el tipo sea *string*. Después cierra sesión y vuelve a entrar. |
| «Correo o contraseña incorrectos» | La contraseña del paso 2 no es la que escribiste. | En Firebase → Authentication → Users, en tu fila, usa el menú de los tres puntos → *Restablecer contraseña*. |
| El botón **Agregar usuario** no funciona | Falta habilitar el acceso por correo. | Authentication → pestaña **Sign-in method** → *Correo electrónico/Contraseña* → activar. |
| Entras con Google y te saca | Tu cuenta de Google no tiene perfil en Arky. | Es lo mismo del primer caso: el ID del documento tiene que ser la UID **de esa** cuenta de Google, que también aparece en Authentication → Users. |

---

## Preguntas razonables

**¿Puedo saltarme esto con una casilla en la configuración?**
No, y es a propósito. Cualquier atajo del tipo «el primero que entre queda como
administrador» convierte una carrera en un privilegio: quien llegue antes al
enlace se queda con el sistema. Es justamente lo que se eliminó.

**¿Hago esto cada vez que se despliega la aplicación?**
No. Una vez por instalación. Los despliegues no borran usuarios.

**¿Y si me quedo sin ningún administrador?**
Solo puede pasar si alguien borra la última cuenta administradora, y Arky no lo
permite: nadie puede borrarse a sí mismo. Si aun así ocurriera, se vuelve a esta
guía y se repite el paso 3 sobre la cuenta que corresponda.

**¿Puedo tener más de un superadministrador?**
Sí, y conviene: si eres el único y pierdes el acceso, nadie puede nombrar
administradores. Crea al menos un segundo desde *Seguridad* — solo un
superadministrador puede conceder ese rol.

---

*Versión técnica de este mismo procedimiento, con el Admin SDK y custom claims:*
[`docs/security-hardening.md`](./security-hardening.md) §3.2.
