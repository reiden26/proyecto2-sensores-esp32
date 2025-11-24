

from fastapi import FastAPI, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, String, text
import os
from dotenv import load_dotenv

from database import get_db, engine
import models, schemas, auth

from fastapi.middleware.cors import CORSMiddleware


SENSOR_CONNECT_GRACE_SECONDS = int(os.getenv("SENSOR_CONNECT_GRACE_SECONDS", "15"))

load_dotenv()

app = FastAPI(title="API Sensores Proyecto 2")

models.Base.metadata.create_all(bind=engine)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://proyecto2-sensores-esp32.vercel.app",
        "https://proyecto2-sensores-esp32.onrender.com",
        "http://localhost:4200",
        "http://localhost:5173",
        "http://127.0.0.1:4200",
        "http://127.0.0.1:5173",
        
        "http://10.0.2.2:8000",  # Android emulator
        "http://localhost:*",    
        "*",  
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ----------- ENDPOINTS -----------

# ----------- UTILIDADES DE UMBRALES Y SEVERIDAD -----------
def _get_thresholds(db: Session) -> dict:
    """Obtiene umbrales globales configurados; si no existen, usa defaults."""
    # Valores por defecto ajustados a estándares realistas de calidad del aire
    cfg = db.query(models.ConfiguracionSistema).first()
    return {
        "mq135_warning": float(getattr(cfg, "mq135_warning_threshold", 20) or 20),     # Calidad aire: advertencia desde 20
        "mq135_bad": float(getattr(cfg, "mq135_bad_threshold", 50) or 50),           # Calidad aire: malo desde 50
        "mq4_warning": float(getattr(cfg, "mq4_warning_threshold", 10) or 10),        # Metano: advertencia desde 10
        "mq4_bad": float(getattr(cfg, "mq4_bad_threshold", 50) or 50),                 # Metano: malo desde 50
        "mq7_warning": float(getattr(cfg, "mq7_warning_threshold", 9) or 9),         # CO: advertencia desde 9
        "mq7_bad": float(getattr(cfg, "mq7_bad_threshold", 35) or 35),                 # CO: malo desde 35
        # volumen
        "mq135_win_h": int(getattr(cfg, "mq135_min_count_window_hours", 1) or 1),
        "mq135_min_count": int(getattr(cfg, "mq135_min_count_threshold", 1) or 1),
        "mq4_win_h": int(getattr(cfg, "mq4_min_count_window_hours", 1) or 1),
        "mq4_min_count": int(getattr(cfg, "mq4_min_count_threshold", 1) or 1),
        "mq7_win_h": int(getattr(cfg, "mq7_min_count_window_hours", 1) or 1),
        "mq7_min_count": int(getattr(cfg, "mq7_min_count_threshold", 1) or 1),
    }

def calcular_severidad_dinamica(sensor_codigo: str, valor: float, db: Session) -> str:
    
    try:
        v = float(valor)
    except Exception:
        return "bueno"
    th = _get_thresholds(db)
    sc = (sensor_codigo or "").lower()
    if sc == "mq135":
        return "bueno" if v < th["mq135_warning"] else ("advertencia" if v < th["mq135_bad"] else "malo")
    if sc == "mq4":
        return "bueno" if v < th["mq4_warning"] else ("advertencia" if v < th["mq4_bad"] else "malo")
    if sc == "mq7":
        return "bueno" if v < th["mq7_warning"] else ("advertencia" if v < th["mq7_bad"] else "malo")
    return "bueno"

# Obtener usuario por id
@app.get("/usuarios/{usuario_id}")
def obtener_usuario(usuario_id: int, current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Obtener usuario por ID (usuario o admin)"""
    # Solo admin puede ver otros usuarios, usuarios solo pueden verse a sí mismos
    if current_user.rol.value != "admin" and current_user.id != usuario_id:
        raise HTTPException(status_code=403, detail="No tienes permisos para ver este usuario")
    
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {
        "id": usuario.id,
        "nombre": usuario.nombre,
        "email": usuario.email,
        "rol": usuario.rol.value,
        "imagen_url": usuario.imagen_url
    }


@app.get("/usuario/actual")
def obtener_usuario_actual(authorization: str = Header(None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token requerido")
    
    token = authorization.split(" ")[1]
    payload = auth.verify_token(token)
    
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido")
    
    user = db.query(models.Usuario).filter(models.Usuario.email == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    return {
        "id": user.id,
        "nombre": user.nombre,
        "email": user.email,
        "rol": user.rol.value,
        "imagen_url": user.imagen_url
    }


# ----------- ENDPOINTS -----------

@app.post("/register")
def register(usuario: schemas.UsuarioCreate, db: Session = Depends(get_db)):
    # Verificar si ya existe
    user_exist = db.query(models.Usuario).filter(models.Usuario.email == usuario.email).first()
    if user_exist:
        raise HTTPException(status_code=400, detail="El email ya está registrado")

    nuevo_usuario = models.Usuario(
        nombre=usuario.nombre,
        email=usuario.email,
        password=auth.hash_password(usuario.password),
        rol=models.RolEnum.usuario
    )
    db.add(nuevo_usuario)
    db.commit()
    db.refresh(nuevo_usuario)
    return {"mensaje": "Usuario creado correctamente", "usuario_id": nuevo_usuario.id}

@app.options("/login")
def login_options():
    return {"message": "OK"}

@app.post("/login")
def login(usuario: schemas.UsuarioLogin, db: Session = Depends(get_db)):
    user = db.query(models.Usuario).filter(models.Usuario.email == usuario.email).first()
    if not user:
        raise HTTPException(status_code=400, detail="Usuario no existe")
    if not auth.verify_password(usuario.password, user.password):
        raise HTTPException(status_code=400, detail="Contraseña incorrecta")

    # Cerrar sesiones activas previas del usuario
    sesiones_activas = db.query(models.SesionUsuario).filter(
        models.SesionUsuario.usuario_id == user.id,
        models.SesionUsuario.activo == True
    ).all()
    
    for sesion in sesiones_activas:
        sesion.activo = False
        sesion.fin = func.now()
    
    # Crear nueva sesión
    nueva_sesion = models.SesionUsuario(
        usuario_id=user.id,
        activo=True,
        inicio=func.now()
    )
    db.add(nueva_sesion)
    db.commit()

    token_data = {"sub": user.email, "nombre": user.nombre, "rol": user.rol.value, "user_id": user.id, "imagen_url": user.imagen_url}
    token = auth.create_access_token(data=token_data, db=db)
    return {"access_token": token, "token_type": "bearer", "rol": user.rol.value}

@app.post("/logout")
def logout(authorization: str = Header(None), db: Session = Depends(get_db)):
    """Cerrar sesión del usuario actual"""
    
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token requerido")
    
    token = authorization.split(" ")[1]
    
    payload = auth.verify_token(token)
    
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido")
    
    # Obtener usuario sin verificar sesión activa
    user = db.query(models.Usuario).filter(models.Usuario.email == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    
    # Marcar sesión como inactiva
    sesion_activa = db.query(models.SesionUsuario).filter(
        models.SesionUsuario.usuario_id == user.id,
        models.SesionUsuario.activo == True
    ).first()
    
    if sesion_activa:
        sesion_activa.activo = False
        sesion_activa.fin = func.now()
        db.commit()
        return {"mensaje": "Sesión cerrada correctamente"}
    else:
        return {"mensaje": "No hay sesión activa para cerrar"}

# ----------- RUTAS DE GESTIÓN DE USUARIOS (SOLO ADMIN) -----------

@app.get("/usuarios")
def obtener_usuarios(current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Obtener todos los usuarios (solo admin)"""
    usuarios = db.query(models.Usuario).all()
    return [
        {
            "id": usuario.id,
            "nombre": usuario.nombre,
            "email": usuario.email,
            "rol": usuario.rol.value
        }
        for usuario in usuarios
    ]

@app.post("/usuarios")
def crear_usuario(usuario: schemas.UsuarioCreate, current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Crear nuevo usuario (solo admin)"""
    # Verificar si ya existe
    user_exist = db.query(models.Usuario).filter(models.Usuario.email == usuario.email).first()
    if user_exist:
        raise HTTPException(status_code=400, detail="El email ya está registrado")

    nuevo_usuario = models.Usuario(
        nombre=usuario.nombre,
        email=usuario.email,
        password=auth.hash_password(usuario.password),
        rol=models.RolEnum.usuario
    )
    db.add(nuevo_usuario)
    db.commit()
    db.refresh(nuevo_usuario)
    return {"mensaje": "Usuario creado correctamente", "usuario_id": nuevo_usuario.id}

@app.put("/usuarios/{usuario_id}")
def actualizar_usuario(usuario_id: int, usuario: schemas.UsuarioUpdate, current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Actualizar usuario existente (usuario o admin)"""
    
    # Solo admin puede actualizar otros usuarios, usuarios solo pueden actualizarse a sí mismos
    if current_user.rol.value != "admin" and current_user.id != usuario_id:
        raise HTTPException(status_code=403, detail="No tienes permisos para actualizar este usuario")
    
    db_usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not db_usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Actualizar campos permitidos (nombre, email, password, imagen_url)
    if usuario.nombre:
        db_usuario.nombre = usuario.nombre
    if usuario.email:
        db_usuario.email = usuario.email
    if usuario.password:
        # Verificar contraseña actual si se proporciona
        if hasattr(usuario, 'password_actual') and usuario.password_actual:
            if not auth.verify_password(usuario.password_actual, db_usuario.password):
                raise HTTPException(status_code=400, detail="La contraseña actual es incorrecta")
        db_usuario.password = auth.hash_password(usuario.password)
    if usuario.imagen_url is not None:
        db_usuario.imagen_url = usuario.imagen_url

    db.commit()
    db.refresh(db_usuario)
    return {"mensaje": "Usuario actualizado correctamente"}

@app.delete("/usuarios/{usuario_id}")
def eliminar_usuario(usuario_id: int, current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Eliminar usuario (solo admin)"""
    db_usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not db_usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    db.delete(db_usuario)
    db.commit()
    return {"mensaje": "Usuario eliminado correctamente"}

@app.get("/")
def root():
    return {"mensaje": "Bienvenido a la API"}

# Función para limpiar sesiones expiradas (se puede llamar periódicamente)
def limpiar_sesiones_expiradas(db: Session):
    """Limpiar sesiones de usuario que han expirado por tiempo"""
    from datetime import datetime, timedelta, timezone
    
    # Considerar expiradas las sesiones activas de más de 30 minutos sin actividad
    tiempo_expiracion = datetime.now() - timedelta(minutes=30)
    
    sesiones_expiradas = db.query(models.SesionUsuario).filter(
        models.SesionUsuario.activo == True,
        models.SesionUsuario.inicio < tiempo_expiracion
    ).all()
    
    for sesion in sesiones_expiradas:
        sesion.activo = False
        sesion.fin = func.now()
    
    db.commit()
    return len(sesiones_expiradas)

@app.post("/admin/limpiar-sesiones")
def limpiar_sesiones_admin(current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Endpoint para limpiar sesiones expiradas (solo admin)"""
    sesiones_limpiadas = limpiar_sesiones_expiradas(db)
    return {"mensaje": f"Se limpiaron {sesiones_limpiadas} sesiones expiradas"}

@app.get("/admin/estado-usuarios")
def obtener_estado_usuarios_tiempo_real(current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Obtener estado de usuarios en tiempo real para reportes"""
    # Limpiar sesiones expiradas primero
    limpiar_sesiones_expiradas(db)
    
    # Obtener datos actualizados
    usuarios_actividad = []
    usuarios = db.query(models.Usuario).all()
    
    for usuario in usuarios:
        # Verificar si está conectado (sesión de usuario activa)
        try:
            sesion_usuario_activa = db.query(models.SesionUsuario).filter(
                models.SesionUsuario.usuario_id == usuario.id,
                models.SesionUsuario.activo == True
            ).first()
            esta_conectado = sesion_usuario_activa is not None
            
            # Obtener última sesión de usuario (login/logout)
            ultima_sesion_usuario = db.query(models.SesionUsuario).filter(
                models.SesionUsuario.usuario_id == usuario.id
            ).order_by(models.SesionUsuario.inicio.desc()).first()
            
            ultima_conexion = ultima_sesion_usuario.fin.isoformat() if ultima_sesion_usuario and ultima_sesion_usuario.fin else None
            
        except Exception as e:
            esta_conectado = False
            ultima_conexion = None
        
        usuarios_actividad.append({
            "id": usuario.id,
            "nombre": usuario.nombre,
            "email": usuario.email,
            "esta_conectado": esta_conectado,
            "ultima_conexion": ultima_conexion
        })
    
    return {"usuarios": usuarios_actividad}


# ----------- SENSORES (ADMIN) -----------

@app.get("/sensores")
def listar_sensores(current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    sensores = db.query(models.Sensor).all()
    return [
        {"id": s.id, "codigo": s.codigo, "nombre": s.nombre, "descripcion": s.descripcion}
        for s in sensores
    ]


# ----------- ASIGNACIÓN DE SENSORES A USUARIO (ADMIN) -----------

# Eliminado endpoint duplicado /usuarios/{usuario_id}/sensores (se conserva la versión posterior)


@app.get("/sensores/activos")
def obtener_sensores_activos(current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Obtiene el estado activo/inactivo de los sensores para el usuario actual"""
    sensores_activos = db.query(models.SensoresActivos).filter(
        models.SensoresActivos.usuario_id == current_user.id
    ).first()
    
    if not sensores_activos:
        return {
            "mq135_activo": False,
            "mq4_activo": False,
            "mq7_activo": False
        }
    
    return {
        "mq135_activo": sensores_activos.mq135_activo,
        "mq4_activo": sensores_activos.mq4_activo,
        "mq7_activo": sensores_activos.mq7_activo
    }




@app.put("/usuarios/{usuario_id}/sensores")
def actualizar_sensores_usuario(usuario_id: int, payload: schemas.UsuarioSensorUpdate, current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    # Validar usuario
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Borrar asignaciones actuales
    db.query(models.UsuarioSensor).filter(models.UsuarioSensor.usuario_id == usuario_id).delete()
    db.commit()

    # Insertar nuevas
    for sensor_id in payload.asignados:
        relacion = models.UsuarioSensor(usuario_id=usuario_id, sensor_id=sensor_id)
        db.add(relacion)
    db.commit()
    return {"mensaje": "Sensores actualizados"}


# ----------- LECTURAS (TOKEN REQUERIDO, SIN RESTRICCIÓN DE ROL) -----------


@app.get("/lecturas")
def listar_lecturas(
    usuario_id: int | None = None,
    sensor_id: int | None = None,
    estado: str | None = None,
    limit: int | None = None,
    current_user: models.Usuario = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    q = db.query(models.Lectura)
    if usuario_id:
        q = q.filter(models.Lectura.usuario_id == usuario_id)
    if sensor_id:
        q = q.filter(models.Lectura.sensor_id == sensor_id)
    if estado:
        try:
            estado_enum = models.EstadoLecturaEnum(estado)
            q = q.filter(models.Lectura.estado == estado_enum)
        except Exception:
            raise HTTPException(status_code=400, detail="Estado inválido")

    q = q.order_by(models.Lectura.creado_en.desc())
    if limit:
        q = q.limit(limit)
    lecturas = q.all()
    
    # Obtener información del sensor para cada lectura
    result = []
    for l in lecturas:
        sensor = db.query(models.Sensor).filter(models.Sensor.id == l.sensor_id).first()
        result.append({
            "id": l.id,
            "sensor_id": l.sensor_id,
            "sensor_codigo": sensor.codigo if sensor else None,
            "usuario_id": l.usuario_id,
            "valor": l.valor,
            "estado": l.estado.value,
            "creado_en": l.creado_en
        })
    
    return result


# ----------- LECTURAS DEL USUARIO ACTUAL -----------



# ----------- SESIONES DE CAPTURA -----------

@app.post("/captura/activar/{sensor_codigo}")
def activar_captura(sensor_codigo: str, current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    from datetime import datetime, timedelta, timezone
    
    # Verificar que el sensor existe
    if sensor_codigo not in ['mq135', 'mq4', 'mq7']:
        raise HTTPException(status_code=404, detail="Sensor no encontrado")
    
    # Validar que el usuario tenga ASIGNADO este sensor
    sensor_obj = db.query(models.Sensor).filter(models.Sensor.codigo == sensor_codigo).first()
    if not sensor_obj:
        raise HTTPException(status_code=404, detail="Sensor no encontrado")
    asignacion = db.query(models.UsuarioSensor).filter(
        models.UsuarioSensor.usuario_id == current_user.id,
        models.UsuarioSensor.sensor_id == sensor_obj.id
    ).first()
    if not asignacion:
        raise HTTPException(status_code=403, detail="Sensor no asignado al usuario")
    
    # Verificar si hay lecturas recientes usando el tiempo de BD para evitar desfases de TZ
    # Consideramos reciente si hubo lecturas en los últimos SENSOR_CONNECT_GRACE_SECONDS segundos
    reciente_seg = max(5, min(SENSOR_CONNECT_GRACE_SECONDS, 300))
    limite_sql = func.date_sub(func.now(), text(f"INTERVAL {reciente_seg} SECOND"))

    tiene_lecturas_recientes = False
    recientes_count = 0
    if sensor_codigo == 'mq135':
        recientes_count = db.query(func.count(models.LecturaMQ135.id)).filter(
            models.LecturaMQ135.usuario_id == current_user.id,
            models.LecturaMQ135.creado_en >= limite_sql
        ).scalar() or 0
    elif sensor_codigo == 'mq4':
        recientes_count = db.query(func.count(models.LecturaMQ4.id)).filter(
            models.LecturaMQ4.usuario_id == current_user.id,
            models.LecturaMQ4.creado_en >= limite_sql
        ).scalar() or 0
    elif sensor_codigo == 'mq7':
        recientes_count = db.query(func.count(models.LecturaMQ7.id)).filter(
            models.LecturaMQ7.usuario_id == current_user.id,
            models.LecturaMQ7.creado_en >= limite_sql
        ).scalar() or 0
    tiene_lecturas_recientes = recientes_count > 0

    # Logs de depuración controlados
    try:
        print(f"[DEBUG] activar_captura user={current_user.id} sensor={sensor_codigo} recientes({reciente_seg}s)={recientes_count} conectado={tiene_lecturas_recientes}")
    except Exception:
        pass
    
    # Obtener o crear registro de sensores activos para el usuario
    sensores_activos = db.query(models.SensoresActivos).filter(
        models.SensoresActivos.usuario_id == current_user.id
    ).first()
    
    if not sensores_activos:
        sensores_activos = models.SensoresActivos(usuario_id=current_user.id)
        db.add(sensores_activos)
    
    # Activar el sensor específico
    if sensor_codigo == 'mq135':
        sensores_activos.mq135_activo = True
    elif sensor_codigo == 'mq4':
        sensores_activos.mq4_activo = True
    elif sensor_codigo == 'mq7':
        sensores_activos.mq7_activo = True
    
    # Asegurar sesión de captura activa incluso sin lecturas (período de gracia de conexión)
    sesion_activa = db.query(models.SesionCaptura).filter(
        models.SesionCaptura.usuario_id == current_user.id,
        models.SesionCaptura.sensor_codigo == sensor_codigo,
        models.SesionCaptura.activo == True
    ).first()
    if not sesion_activa:
        nueva_sesion = models.SesionCaptura(
            usuario_id=current_user.id,
            sensor_codigo=sensor_codigo,
            activo=True
        )
        db.add(nueva_sesion)
    
    # Si no hay lecturas recientes, indicar estado de conexión inicial
    if not tiene_lecturas_recientes:
        sensor_nombres = {
            'mq135': 'MQ-135 (Calidad del aire)',
            'mq4': 'MQ-4 (Metano)',
            'mq7': 'MQ-7 (Monóxido de carbono)'
        }
        # Evitar notificar inmediatamente: dar un pequeño margen para que el ESP32 comience a enviar
        # El frontend mostrará estado 'Conectando' durante unos segundos
    
    db.commit()
    
    return {
        "mensaje": f"Captura activada para {sensor_codigo.upper()}",
        "conectado": tiene_lecturas_recientes,
        "sensor_codigo": sensor_codigo,
        "advertencia": not tiene_lecturas_recientes,
        "estado": "connected" if tiene_lecturas_recientes else "connecting",
        "grace_seconds": reciente_seg,
    }


@app.post("/captura/desactivar/{sensor_codigo}")
def desactivar_captura(sensor_codigo: str, current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    # Verificar que el sensor existe
    if sensor_codigo not in ['mq135', 'mq4', 'mq7']:
        raise HTTPException(status_code=404, detail="Sensor no encontrado")
    
    # Obtener registro de sensores activos para el usuario
    sensores_activos = db.query(models.SensoresActivos).filter(
        models.SensoresActivos.usuario_id == current_user.id
    ).first()
    
    if not sensores_activos:
        raise HTTPException(status_code=404, detail="No hay sensores activos")
    
    # Desactivar el sensor específico
    if sensor_codigo == 'mq135':
        sensores_activos.mq135_activo = False
    elif sensor_codigo == 'mq4':
        sensores_activos.mq4_activo = False
    elif sensor_codigo == 'mq7':
        sensores_activos.mq7_activo = False
    
    # Finalizar sesión de captura activa solo si existe y tiene lecturas
    sesion_activa = db.query(models.SesionCaptura).filter(
        models.SesionCaptura.usuario_id == current_user.id,
        models.SesionCaptura.sensor_codigo == sensor_codigo,
        models.SesionCaptura.activo == True
    ).first()
    
    if sesion_activa and sesion_activa.total_lecturas > 0:
        sesion_activa.activo = False
        sesion_activa.finalizado_en = func.now()
    elif sesion_activa and sesion_activa.total_lecturas == 0:
        # Eliminar sesión vacía sin datos
        db.delete(sesion_activa)
    
    db.commit()
    return {"mensaje": "OK"}


# ----------- INGESTA DESDE DISPOSITIVO (API KEY) -----------



DEVICE_API_KEY = os.getenv("DEVICE_API_KEY", "ESP32_SENSOR_KEY_2024")

@app.post("/lecturas/device")
def crear_lectura_device(
    data: schemas.LecturaCreateDevice,
    x_api_key: str | None = Header(default=None, alias="X-API-KEY"),
    db: Session = Depends(get_db)
):
    # Validar API KEY
    if not x_api_key or x_api_key != DEVICE_API_KEY:
        raise HTTPException(status_code=401, detail="API key inválida")

    # Procesar cada lectura del array
    total_guardadas = 0
    usuarios_afectados = set()
    
    for lectura in data.lecturas:
        # Verificar que el sensor es válido
        if lectura.sensor_codigo not in ['mq135', 'mq4', 'mq7']:
            continue

        # Buscar usuarios que tienen activo este sensor
        sensores_activos = db.query(models.SensoresActivos).filter(
            getattr(models.SensoresActivos, f"{lectura.sensor_codigo}_activo") == True
        ).all()
        
        if not sensores_activos:
            continue

        # Filtrar por usuarios que tengan ASIGNADO este sensor
        sensor_obj = db.query(models.Sensor).filter(models.Sensor.codigo == lectura.sensor_codigo).first()
        if not sensor_obj:
            continue
        usuarios_con_permiso = []
        for sensor_activo in sensores_activos:
            asignacion = db.query(models.UsuarioSensor).filter(
                models.UsuarioSensor.usuario_id == sensor_activo.usuario_id,
                models.UsuarioSensor.sensor_id == sensor_obj.id
            ).first()
            if asignacion:
                usuarios_con_permiso.append(sensor_activo)

        if not usuarios_con_permiso:
            continue

        # Guardar lectura en la tabla correspondiente para cada usuario activo con permiso
        for sensor_activo in usuarios_con_permiso:
            if lectura.sensor_codigo == 'mq135':
                nueva = models.LecturaMQ135(
                    usuario_id=sensor_activo.usuario_id,
                    valor=float(lectura.valor),
                    estado=models.EstadoLecturaEnum(lectura.estado.value)
                )
            elif lectura.sensor_codigo == 'mq4':
                nueva = models.LecturaMQ4(
                    usuario_id=sensor_activo.usuario_id,
                    valor=float(lectura.valor),
                    estado=models.EstadoLecturaEnum(lectura.estado.value)
                )
            elif lectura.sensor_codigo == 'mq7':
                nueva = models.LecturaMQ7(
                    usuario_id=sensor_activo.usuario_id,
                    valor=float(lectura.valor),
                    estado=models.EstadoLecturaEnum(lectura.estado.value)
                )
            
            db.add(nueva)
            db.flush()  # Para obtener el ID de la lectura recién creada
            usuarios_afectados.add(sensor_activo.usuario_id)
            total_guardadas += 1
            
            # Crear notificación si el usuario la tiene configurada
            crear_notificacion_si_necesario(
                db, 
                sensor_activo.usuario_id, 
                lectura.sensor_codigo, 
                float(lectura.valor), 
                lectura.estado.value
            )

            # Evaluar y persistir alerta personalizada (si aplica)
            try:
                evaluar_alerta_personalizada(db, sensor_activo.usuario_id, lectura.sensor_codigo, float(lectura.valor))
            except Exception:
                pass
            
            # Actualizar contador de lecturas en sesión activa
            sesion_activa = db.query(models.SesionCaptura).filter(
                models.SesionCaptura.usuario_id == sensor_activo.usuario_id,
                models.SesionCaptura.sensor_codigo == lectura.sensor_codigo,
                models.SesionCaptura.activo == True
            ).first()
            
            if sesion_activa:
                sesion_activa.total_lecturas += 1
    
    db.commit()
    return {
        "mensaje": f"Lecturas guardadas: {total_guardadas} para {len(usuarios_afectados)} usuarios", 
        "usuarios": list(usuarios_afectados),
        "lecturas_procesadas": len(data.lecturas)
    }


# ----------- ACTUALIZAR LECTURA (ADMIN) -----------

from datetime import datetime

@app.put("/lecturas/{sensor_codigo}/{lectura_id}")
def actualizar_lectura(
    sensor_codigo: str,
    lectura_id: int,
    payload: dict,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Actualizar una lectura específica (solo admin).
    Recalcula el estado en base al nuevo valor y actualiza fecha si se envía.
    """

    sensor_codigo = sensor_codigo.lower()
    if sensor_codigo not in ["mq135", "mq4", "mq7"]:
        raise HTTPException(status_code=400, detail="Sensor no válido")

    # Seleccionar tabla
    if sensor_codigo == "mq135":
        tabla = models.LecturaMQ135
    elif sensor_codigo == "mq4":
        tabla = models.LecturaMQ4
    else:  # mq7
        tabla = models.LecturaMQ7

    lectura = db.query(tabla).filter(tabla.id == lectura_id).first()
    if not lectura:
        raise HTTPException(status_code=404, detail="Lectura no encontrada")

    # Extraer valores a actualizar
    nuevo_valor = payload.get("valor", lectura.valor)
    try:
        nuevo_valor = float(nuevo_valor)
    except Exception:
        raise HTTPException(status_code=400, detail="Valor inválido")

    fecha_lectura_str = payload.get("fecha_lectura")
    nueva_fecha = None
    if fecha_lectura_str:
        try:
            # Intentar parseo ISO; si viene con 'Z' o sin tz, manejarlo
            nueva_fecha = datetime.fromisoformat(fecha_lectura_str.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=400, detail="Fecha de lectura inválida")

    # Recalcular estado según umbrales del Arduino
    # mq135: bueno<400, advertencia<1000, sino malo
    # mq4:   bueno<1000, advertencia<5000, sino malo
    # mq7:   bueno<9, advertencia<35, sino malo
    if sensor_codigo == "mq135":
        estado_str = "bueno" if nuevo_valor < 400 else ("advertencia" if nuevo_valor < 1000 else "malo")
    elif sensor_codigo == "mq4":
        estado_str = "bueno" if nuevo_valor < 1000 else ("advertencia" if nuevo_valor < 5000 else "malo")
    else:  # mq7
        estado_str = "bueno" if nuevo_valor < 9 else ("advertencia" if nuevo_valor < 35 else "malo")

    # Aplicar cambios
    lectura.valor = nuevo_valor
    try:
        lectura.estado = models.EstadoLecturaEnum(estado_str)
    except Exception:
        # Fallback prudente
        lectura.estado = models.EstadoLecturaEnum.bueno

    if nueva_fecha is not None:
        # Campos de timestamp en modelos individuales se llaman creado_en
        lectura.creado_en = nueva_fecha

    db.commit()
    db.refresh(lectura)

    return {
        "message": "Lectura actualizada correctamente",
        "id": lectura.id,
        "valor": lectura.valor,
        "estado": lectura.estado.value,
        "fecha_lectura": getattr(lectura, "creado_en", None).isoformat() if getattr(lectura, "creado_en", None) else None
    }


# ----------- OBTENER LECTURAS DEL USUARIO -----------

@app.get("/lecturas/me")
def obtener_mis_lecturas(current_user: models.Usuario = Depends(auth.get_current_user), limit: int | None = None, db: Session = Depends(get_db)):
    result = {
        "mq135": [],
        "mq4": [],
        "mq7": []
    }
    
    # Obtener lecturas MQ-135
    query_mq135 = db.query(models.LecturaMQ135).filter(models.LecturaMQ135.usuario_id == current_user.id).order_by(models.LecturaMQ135.creado_en.desc())
    if limit:
        query_mq135 = query_mq135.limit(limit)
    result["mq135"] = [{"id": l.id, "valor": l.valor, "estado": l.estado.value, "creado_en": l.creado_en} for l in query_mq135.all()]
    
    # Obtener lecturas MQ-4
    query_mq4 = db.query(models.LecturaMQ4).filter(models.LecturaMQ4.usuario_id == current_user.id).order_by(models.LecturaMQ4.creado_en.desc())
    if limit:
        query_mq4 = query_mq4.limit(limit)
    result["mq4"] = [{"id": l.id, "valor": l.valor, "estado": l.estado.value, "creado_en": l.creado_en} for l in query_mq4.all()]
    
    # Obtener lecturas MQ-7
    query_mq7 = db.query(models.LecturaMQ7).filter(models.LecturaMQ7.usuario_id == current_user.id).order_by(models.LecturaMQ7.creado_en.desc())
    if limit:
        query_mq7 = query_mq7.limit(limit)
    result["mq7"] = [{"id": l.id, "valor": l.valor, "estado": l.estado.value, "creado_en": l.creado_en} for l in query_mq7.all()]
    
    return result


# ----------- LECTURAS PARA ADMIN (TODOS LOS USUARIOS) -----------

@app.get("/lecturas/admin")
def obtener_lecturas_admin(current_user: models.Usuario = Depends(auth.require_admin), limit: int | None = None, db: Session = Depends(get_db)):
    """Obtener lecturas de todos los usuarios para administración"""
    result = {
        "mq135": [],
        "mq4": [],
        "mq7": []
    }
    
    # Obtener lecturas MQ-135 de todos los usuarios
    query_mq135 = db.query(models.LecturaMQ135).order_by(models.LecturaMQ135.creado_en.desc())
    if limit:
        query_mq135 = query_mq135.limit(limit)
    
    for l in query_mq135.all():
        # Obtener información del usuario
        usuario = db.query(models.Usuario).filter(models.Usuario.id == l.usuario_id).first()
        result["mq135"].append({
            "id": l.id,
            "usuario_id": l.usuario_id,
            "usuario_nombre": usuario.nombre if usuario else "Usuario desconocido",
            "valor": l.valor,
            "estado": l.estado.value,
            "creado_en": l.creado_en,
            "fecha_lectura": l.creado_en.isoformat()
        })
    
    # Obtener lecturas MQ-4 de todos los usuarios
    query_mq4 = db.query(models.LecturaMQ4).order_by(models.LecturaMQ4.creado_en.desc())
    if limit:
        query_mq4 = query_mq4.limit(limit)
    
    for l in query_mq4.all():
        # Obtener información del usuario
        usuario = db.query(models.Usuario).filter(models.Usuario.id == l.usuario_id).first()
        result["mq4"].append({
            "id": l.id,
            "usuario_id": l.usuario_id,
            "usuario_nombre": usuario.nombre if usuario else "Usuario desconocido",
            "valor": l.valor,
            "estado": l.estado.value,
            "creado_en": l.creado_en,
            "fecha_lectura": l.creado_en.isoformat()
        })
    
    # Obtener lecturas MQ-7 de todos los usuarios
    query_mq7 = db.query(models.LecturaMQ7).order_by(models.LecturaMQ7.creado_en.desc())
    if limit:
        query_mq7 = query_mq7.limit(limit)
    
    for l in query_mq7.all():
        # Obtener información del usuario
        usuario = db.query(models.Usuario).filter(models.Usuario.id == l.usuario_id).first()
        result["mq7"].append({
            "id": l.id,
            "usuario_id": l.usuario_id,
            "usuario_nombre": usuario.nombre if usuario else "Usuario desconocido",
            "valor": l.valor,
            "estado": l.estado.value,
            "creado_en": l.creado_en,
            "fecha_lectura": l.creado_en.isoformat()
        })
    
    return result


# ----------- ANALÍTICA TEMPORAL (conteos) -----------
@app.get("/reportes/analitica")
def obtener_analitica_temporal(
    scope: str = "today",  # today|week|month
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Devuelve conteos de registros por rango (hoy/semana/mes) sumando las tres tablas de lecturas."""
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import func
    
    # Usar UTC para evitar problemas de timezone
    ahora = datetime.now(timezone.utc) - timedelta(hours=5)
    print(f"[BACKEND DEBUG] scope={scope}, ahora={ahora}")  # ← AGREGAR LOG
    if scope == "week":
        desde = ahora - timedelta(days=7)
        label = "Esta semana"
    elif scope == "month":
        desde = ahora - timedelta(days=30)
        label = "Este mes"
    else:
        # Para "today", usar las últimas 24 horas en lugar de desde medianoche
        # Esto evita problemas de timezone
        desde = ahora.replace(hour=0, minute=0, second=0, microsecond=0)
        label = "Hoy"

    # Usar func.date para comparar solo la fecha (ignorando hora) si es necesario
    # Pero mejor usar >= desde directamente
    c135 = db.query(models.LecturaMQ135).filter(models.LecturaMQ135.creado_en >= desde).count()
    c4 = db.query(models.LecturaMQ4).filter(models.LecturaMQ4.creado_en >= desde).count()
    c7 = db.query(models.LecturaMQ7).filter(models.LecturaMQ7.creado_en >= desde).count()
    total = c135 + c4 + c7
    return {"label": label, "desde": desde.isoformat(), "hasta": ahora.isoformat(), "totales": {"mq135": c135, "mq4": c4, "mq7": c7, "total": total}}


@app.delete("/lecturas/{sensor_id}/{lectura_id}")
def eliminar_lectura(
    sensor_id: int, 
    lectura_id: int, 
    current_user: models.Usuario = Depends(auth.require_admin), 
    db: Session = Depends(get_db)
):
    """Eliminar una lectura específica (solo admin)"""
    
    # Determinar la tabla según el sensor_id
    if sensor_id == 1:  # MQ-135
        tabla = models.LecturaMQ135
    elif sensor_id == 2:  # MQ-4
        tabla = models.LecturaMQ4
    elif sensor_id == 3:  # MQ-7
        tabla = models.LecturaMQ7
    else:
        raise HTTPException(status_code=400, detail="Sensor ID inválido")
    
    # Buscar la lectura
    lectura = db.query(tabla).filter(tabla.id == lectura_id).first()
    
    if not lectura:
        raise HTTPException(status_code=404, detail="Lectura no encontrada")
    
    # Eliminar la lectura
    db.delete(lectura)
    db.commit()
    
    return {"message": "Lectura eliminada correctamente"}


@app.get("/usuarios/{usuario_id}/sensores")
def obtener_sensores_usuario(
    usuario_id: int, 
    current_user: models.Usuario = Depends(auth.require_admin), 
    db: Session = Depends(get_db)
):
    """Obtener sensores asignados a un usuario específico"""
    
    # Verificar que el usuario existe
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    # Obtener sensores asignados
    asignaciones = db.query(models.UsuarioSensor).filter(
        models.UsuarioSensor.usuario_id == usuario_id
    ).all()
    
    # Obtener información completa de los sensores
    sensores_asignados = []
    for asignacion in asignaciones:
        sensor = db.query(models.Sensor).filter(models.Sensor.id == asignacion.sensor_id).first()
        if sensor:
            sensores_asignados.append({
                "id": sensor.id,
                "codigo": sensor.codigo,
                "nombre": sensor.nombre,
                "descripcion": sensor.descripcion,
                "asignado_en": asignacion.asignado_en.isoformat()
            })
    
    return {
        "usuario_id": usuario_id,
        "usuario_nombre": usuario.nombre,
        "sensores": sensores_asignados
    }


@app.get("/mis-sensores")
def obtener_mis_sensores(current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Obtener lista de sensores ASIGNADOS del usuario autenticado."""
    asignaciones = db.query(models.UsuarioSensor).filter(
        models.UsuarioSensor.usuario_id == current_user.id
    ).all()
    sensores = []
    for asign in asignaciones:
        sensor = db.query(models.Sensor).filter(models.Sensor.id == asign.sensor_id).first()
        if sensor:
            sensores.append({
                "id": sensor.id,
                "codigo": sensor.codigo,
                "nombre": sensor.nombre,
                "descripcion": sensor.descripcion,
                "asignado_en": asign.asignado_en
            })
    return {"usuario_id": current_user.id, "sensores": sensores}


@app.post("/usuarios/{usuario_id}/sensores/{sensor_id}")
def asignar_sensor_usuario(
    usuario_id: int,
    sensor_id: int,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Asignar un sensor a un usuario"""
    
    # Verificar que el usuario existe
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    # Verificar que el sensor existe
    sensor = db.query(models.Sensor).filter(models.Sensor.id == sensor_id).first()
    if not sensor:
        raise HTTPException(status_code=404, detail="Sensor no encontrado")
    
    # Verificar si ya está asignado
    asignacion_existente = db.query(models.UsuarioSensor).filter(
        models.UsuarioSensor.usuario_id == usuario_id,
        models.UsuarioSensor.sensor_id == sensor_id
    ).first()
    
    if asignacion_existente:
        raise HTTPException(status_code=400, detail="El sensor ya está asignado a este usuario")
    
    # Crear nueva asignación
    nueva_asignacion = models.UsuarioSensor(
        usuario_id=usuario_id,
        sensor_id=sensor_id
    )
    
    db.add(nueva_asignacion)
    db.commit()
    db.refresh(nueva_asignacion)
    
    return {
        "message": "Sensor asignado correctamente",
        "asignacion_id": nueva_asignacion.id
    }


@app.delete("/usuarios/{usuario_id}/sensores/{sensor_id}")
def desasignar_sensor_usuario(
    usuario_id: int,
    sensor_id: int,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Desasignar un sensor de un usuario"""
    
    # Buscar la asignación
    asignacion = db.query(models.UsuarioSensor).filter(
        models.UsuarioSensor.usuario_id == usuario_id,
        models.UsuarioSensor.sensor_id == sensor_id
    ).first()
    
    if not asignacion:
        raise HTTPException(status_code=404, detail="Asignación no encontrada")
    
    # Eliminar la asignación
    db.delete(asignacion)

    # Sincronizar: desactivar en SensoresActivos y cerrar sesión de captura si corresponde
    sensor = db.query(models.Sensor).filter(models.Sensor.id == sensor_id).first()
    if sensor:
        sensores_activos = db.query(models.SensoresActivos).filter(
            models.SensoresActivos.usuario_id == usuario_id
        ).first()
        if sensores_activos:
            if sensor.codigo == 'mq135':
                sensores_activos.mq135_activo = False
            elif sensor.codigo == 'mq4':
                sensores_activos.mq4_activo = False
            elif sensor.codigo == 'mq7':
                sensores_activos.mq7_activo = False

        sesion_activa = db.query(models.SesionCaptura).filter(
            models.SesionCaptura.usuario_id == usuario_id,
            models.SesionCaptura.sensor_codigo == sensor.codigo,
            models.SesionCaptura.activo == True
        ).first()
        if sesion_activa:
            if sesion_activa.total_lecturas > 0:
                sesion_activa.activo = False
                sesion_activa.finalizado_en = func.now()
            else:
                db.delete(sesion_activa)

    db.commit()
    
    return {"message": "Sensor desasignado correctamente"}


@app.get("/reportes/dashboard")
def obtener_dashboard_reportes(current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Obtener datos del dashboard de reportes para admin"""
    
    # Obtener estadísticas de sensores
    total_sensores = db.query(models.Sensor).count()
    
    # Obtener sensores activos (con sesiones activas)
    sensores_activos = db.query(models.Sensor).join(
        models.SesionCaptura, 
        models.Sensor.codigo == models.SesionCaptura.sensor_codigo
    ).filter(
        models.SesionCaptura.activo == True
    ).distinct().count()
    
    sensores_inactivos = total_sensores - sensores_activos
    
    # Obtener alertas activas (advertencia o malo) en las últimas 24h usando umbrales dinámicos
    from datetime import datetime, timedelta, timezone
    hace_24h = datetime.now() - timedelta(hours=24)
    th = _get_thresholds(db)
    # Cuenta todo lo que sea >= WARN (incluye advertencia y malo)
    alertas_mq135 = db.query(models.LecturaMQ135).filter(
        models.LecturaMQ135.creado_en >= hace_24h,
        models.LecturaMQ135.valor >= th['mq135_warning']
    ).count()
    alertas_mq4 = db.query(models.LecturaMQ4).filter(
        models.LecturaMQ4.creado_en >= hace_24h,
        models.LecturaMQ4.valor >= th['mq4_warning']
    ).count()
    alertas_mq7 = db.query(models.LecturaMQ7).filter(
        models.LecturaMQ7.creado_en >= hace_24h,
        models.LecturaMQ7.valor >= th['mq7_warning']
    ).count()
    
    total_alertas = alertas_mq135 + alertas_mq4 + alertas_mq7
    
    return {
        "total_sensores": total_sensores,
        "sensores_activos": sensores_activos,
        "sensores_inactivos": sensores_inactivos,
        "alertas_activas": total_alertas,
        "alertas_por_sensor": {
            "mq135": alertas_mq135,
            "mq4": alertas_mq4,
            "mq7": alertas_mq7
        }
    }


@app.get("/reportes/alertas")
def obtener_alertas_reportes(
    rango: str = None,  # valores: today|week|month|dias
    dias: int = None,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Obtener alertas detalladas para reportes.
    Permite filtrar por rango temporal con query params:
    - rango: today (24h), week (7d), month (30d), dias (usar 'dias')
    - dias: número de días hacia atrás (si rango == 'dias')
    Por defecto: últimas 24 horas.
    """
    
    from datetime import datetime, timedelta
    # Usar hora local naive; si las columnas son naive, esto alinea correctamente
    now = datetime.now()
    if rango == "week":
        desde = now - timedelta(days=7)
    elif rango == "month":
        desde = now - timedelta(days=30)
    elif rango == "dias" and dias and dias > 0:
        desde = now - timedelta(days=dias)
    else:
        # today por defecto: 24h
        desde = now - timedelta(hours=24)
    
    
    alertas = []
    # Mapa de usuarios id->nombre para completar el nombre en cada alerta
    usuarios_map = {u.id: (u.nombre or getattr(u, 'email', None) or str(u.id)) for u in db.query(models.Usuario).all()}
    usuarios_email = {u.id: getattr(u, 'email', None) for u in db.query(models.Usuario).all()}
    
    # Usar directamente creado_en para evitar ambigüedades

    # Predicado de severidad compatible con Enum y cadenas
    sev_ok_mq135 = (
        (models.LecturaMQ135.estado.in_([models.EstadoLecturaEnum.advertencia, models.EstadoLecturaEnum.malo])) |
        (func.lower(cast(models.LecturaMQ135.estado, String)).in_(['advertencia', 'malo', 'mala']))
    )
    sev_ok_mq4 = (
        (models.LecturaMQ4.estado.in_([models.EstadoLecturaEnum.advertencia, models.EstadoLecturaEnum.malo])) |
        (func.lower(cast(models.LecturaMQ4.estado, String)).in_(['advertencia', 'malo', 'mala']))
    )
    sev_ok_mq7 = (
        (models.LecturaMQ7.estado.in_([models.EstadoLecturaEnum.advertencia, models.EstadoLecturaEnum.malo])) |
        (func.lower(cast(models.LecturaMQ7.estado, String)).in_(['advertencia', 'malo', 'mala']))
    )

    # Función para recalcular severidad por valor (valores actualizados) con umbrales dinámicos
    def calcular_severidad(sensor_codigo: str, valor: float) -> str:
        return calcular_severidad_dinamica(sensor_codigo, valor, db)

    # Alertas MQ-135
    lecturas_mq135 = db.query(models.LecturaMQ135).join(
        models.Usuario, models.LecturaMQ135.usuario_id == models.Usuario.id, isouter=True
    ).filter(
        models.LecturaMQ135.creado_en >= desde
    ).order_by(models.LecturaMQ135.creado_en.desc()).limit(200).all()
    
    
    for lectura in lecturas_mq135:
        severidad = calcular_severidad('mq135', lectura.valor)
        if severidad == 'malo':
            mensaje = "Calidad del aire peligrosa"
        elif severidad == 'advertencia':
            mensaje = "Calidad del aire con advertencia"
        else:
            mensaje = "Calidad del aire en rango normal"
        
        alertas.append({
            "id": f"mq135_{lectura.id}",
            "sensor": "MQ-135",
            "sensor_nombre": "Calidad del Aire",
            "mensaje": mensaje,
            "severidad": severidad,
            "valor": lectura.valor,
            "usuario": usuarios_map.get(getattr(lectura, 'usuario_id', None)),
            "usuario_nombre": usuarios_map.get(getattr(lectura, 'usuario_id', None)),
            "correo": usuarios_email.get(getattr(lectura, 'usuario_id', None)),
            "email": usuarios_email.get(getattr(lectura, 'usuario_id', None)),
            "timestamp": lectura.creado_en.isoformat(),
            "creado_en": lectura.creado_en.isoformat(),
            "resuelto": False
        })
    
    # Alertas MQ-4
    lecturas_mq4 = db.query(models.LecturaMQ4).join(
        models.Usuario, models.LecturaMQ4.usuario_id == models.Usuario.id, isouter=True
    ).filter(
        models.LecturaMQ4.creado_en >= desde
    ).order_by(models.LecturaMQ4.creado_en.desc()).limit(200).all()
    
    
    for lectura in lecturas_mq4:
        severidad = calcular_severidad('mq4', lectura.valor)
        if severidad == 'malo':
            mensaje = "Gas metano peligroso"
        elif severidad == 'advertencia':
            mensaje = "Gas metano con advertencia"
        else:
            mensaje = "Gas metano en rango normal"
        
        alertas.append({
            "id": f"mq4_{lectura.id}",
            "sensor": "MQ-4",
            "sensor_nombre": "Gas Metano",
            "mensaje": mensaje,
            "severidad": severidad,
            "valor": lectura.valor,
            "usuario": usuarios_map.get(getattr(lectura, 'usuario_id', None)),
            "usuario_nombre": usuarios_map.get(getattr(lectura, 'usuario_id', None)),
            "correo": usuarios_email.get(getattr(lectura, 'usuario_id', None)),
            "email": usuarios_email.get(getattr(lectura, 'usuario_id', None)),
            "timestamp": lectura.creado_en.isoformat(),
            "creado_en": lectura.creado_en.isoformat(),
            "resuelto": False
        })
    
    # Alertas MQ-7
    lecturas_mq7 = db.query(models.LecturaMQ7).join(
        models.Usuario, models.LecturaMQ7.usuario_id == models.Usuario.id, isouter=True
    ).filter(
        models.LecturaMQ7.creado_en >= desde
    ).order_by(models.LecturaMQ7.creado_en.desc()).limit(200).all()
    
    
    for lectura in lecturas_mq7:
        severidad = calcular_severidad('mq7', lectura.valor)
        if severidad == 'malo':
            mensaje = "Monóxido de carbono peligroso"
        elif severidad == 'advertencia':
            mensaje = "Monóxido de carbono con advertencia"
        else:
            mensaje = "Monóxido de carbono en rango normal"
        
        alertas.append({
            "id": f"mq7_{lectura.id}",
            "sensor": "MQ-7",
            "sensor_nombre": "Monóxido de Carbono",
            "mensaje": mensaje,
            "severidad": severidad,
            "valor": lectura.valor,
            "usuario": usuarios_map.get(getattr(lectura, 'usuario_id', None)),
            "usuario_nombre": usuarios_map.get(getattr(lectura, 'usuario_id', None)),
            "correo": usuarios_email.get(getattr(lectura, 'usuario_id', None)),
            "email": usuarios_email.get(getattr(lectura, 'usuario_id', None)),
            "timestamp": lectura.creado_en.isoformat(),
            "creado_en": lectura.creado_en.isoformat(),
            "resuelto": False
        })
    
    # Ordenar por timestamp descendente
    alertas.sort(key=lambda x: x['timestamp'], reverse=True)
    
    
    return {"alertas": alertas}


@app.get("/reportes/alertas-personalizadas")
def obtener_alertas_personalizadas(
    rango: str | None = None,  # today|week|month|dias
    dias: int | None = None,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    from datetime import datetime, timedelta
    now = datetime.now()
    if rango == "week":
        desde = now - timedelta(days=7)
    elif rango == "month":
        desde = now - timedelta(days=30)
    elif rango == "dias" and dias and dias > 0:
        desde = now - timedelta(days=dias)
    else:
        desde = now - timedelta(hours=24)

    registros = db.query(models.AlertaPersonalizada).filter(
        models.AlertaPersonalizada.creado_en >= desde
    ).order_by(models.AlertaPersonalizada.creado_en.desc()).limit(500).all()

    usuarios_map = {u.id: (u.nombre or getattr(u, 'email', None) or str(u.id)) for u in db.query(models.Usuario).all()}
    usuarios_email = {u.id: getattr(u, 'email', None) for u in db.query(models.Usuario).all()}

    return {
        "alertas": [
            {
                "id": r.id,
                "sensor": r.sensor_codigo.upper().replace('MQ', 'MQ-'),
                "sensor_codigo": r.sensor_codigo,
                "usuario_id": r.usuario_id,
                "usuario_nombre": usuarios_map.get(r.usuario_id),
                "email": usuarios_email.get(r.usuario_id),
                "valor": r.valor,
                "umbral_usado": r.umbral_usado,
                "tipo_trigger": r.tipo_trigger,
                "severidad": r.severidad_calculada,
                "creado_en": r.creado_en
            }
            for r in registros
        ]
    }


@app.get("/reportes/usuarios")
def obtener_usuarios_reportes(current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Obtener datos de usuarios para reportes"""
    
    # Obtener estadísticas de usuarios
    total_usuarios = db.query(models.Usuario).count()
    admin_usuarios = db.query(models.Usuario).filter(models.Usuario.rol == 'admin').count()
    usuarios_regulares = total_usuarios - admin_usuarios
    
    # Obtener actividad de usuarios
    usuarios_actividad = []
    
    usuarios = db.query(models.Usuario).all()
    for usuario in usuarios:
        # Obtener sensores asignados
        sensores_asignados = db.query(models.UsuarioSensor).filter(
            models.UsuarioSensor.usuario_id == usuario.id
        ).count()
        
        # Verificar si está conectado (sesión de usuario activa)
        try:
            sesion_usuario_activa = db.query(models.SesionUsuario).filter(
                models.SesionUsuario.usuario_id == usuario.id,
                models.SesionUsuario.activo == True
            ).first()
            esta_conectado = sesion_usuario_activa is not None
            
            # Obtener última sesión de usuario (login/logout)
            ultima_sesion_usuario = db.query(models.SesionUsuario).filter(
                models.SesionUsuario.usuario_id == usuario.id
            ).order_by(models.SesionUsuario.inicio.desc()).first()
            
            # Calcular duración de última sesión de usuario
            duracion_sesion = 0
            if ultima_sesion_usuario and ultima_sesion_usuario.fin and ultima_sesion_usuario.inicio:
                duracion = ultima_sesion_usuario.fin - ultima_sesion_usuario.inicio
                duracion_sesion = int(duracion.total_seconds() / 60)  # en minutos
            
            ultima_conexion = ultima_sesion_usuario.fin.isoformat() if ultima_sesion_usuario and ultima_sesion_usuario.fin else None
            
        except Exception as e:
            # Si la tabla sesiones_usuario no existe aún, usar lógica anterior
            esta_conectado = False
            duracion_sesion = 0
            ultima_conexion = None
        
        # Calcular total de lecturas reales del usuario (todas las tablas)
        total_lecturas_mq135 = db.query(models.LecturaMQ135).filter(models.LecturaMQ135.usuario_id == usuario.id).count()
        total_lecturas_mq4 = db.query(models.LecturaMQ4).filter(models.LecturaMQ4.usuario_id == usuario.id).count()
        total_lecturas_mq7 = db.query(models.LecturaMQ7).filter(models.LecturaMQ7.usuario_id == usuario.id).count()
        total_lecturas_usuario = total_lecturas_mq135 + total_lecturas_mq4 + total_lecturas_mq7

        usuarios_actividad.append({
            "id": usuario.id,
            "nombre": usuario.nombre,
            "email": usuario.email,
            "rol": usuario.rol,
            "imagen_url": usuario.imagen_url,
            "sensores_asignados": sensores_asignados,
            "esta_conectado": esta_conectado,
            "ultima_conexion": ultima_conexion,
            "duracion_ultima_sesion": duracion_sesion,
            "total_lecturas": total_lecturas_usuario
        })
    
    return {
        "estadisticas": {
            "total_usuarios": total_usuarios,
            "admin_usuarios": admin_usuarios,
            "usuarios_regulares": usuarios_regulares
        },
        "actividad_usuarios": usuarios_actividad
    }


@app.get("/reportes/sensores")
def obtener_sensores_reportes(current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Obtener estado detallado de sensores para reportes"""
    
    sensores_estado = []
    
    # Obtener todos los sensores
    sensores = db.query(models.Sensor).all()
    
    for sensor in sensores:
        # Verificar si está activo (tiene sesiones activas)
        sesiones_activas = db.query(models.SesionCaptura).filter(
            models.SesionCaptura.sensor_codigo == sensor.codigo,
            models.SesionCaptura.activo == True
        ).count()
        
        estado = "active" if sesiones_activas > 0 else "inactive"
        
        # Obtener última lectura
        ultima_lectura = None
        if sensor.codigo == "mq135":
            ultima_lectura = db.query(models.LecturaMQ135).order_by(
                models.LecturaMQ135.creado_en.desc()
            ).first()
        elif sensor.codigo == "mq4":
            ultima_lectura = db.query(models.LecturaMQ4).order_by(
                models.LecturaMQ4.creado_en.desc()
            ).first()
        elif sensor.codigo == "mq7":
            ultima_lectura = db.query(models.LecturaMQ7).order_by(
                models.LecturaMQ7.creado_en.desc()
            ).first()
        
        valor_actual = ultima_lectura.valor if ultima_lectura else 0.0
        ultima_actualizacion = ultima_lectura.creado_en if ultima_lectura else None
        
        sensores_estado.append({
            "id": sensor.id,
            "codigo": sensor.codigo,
            "nombre": sensor.nombre,
            "descripcion": sensor.descripcion,
            "estado": estado,
            "valor_actual": valor_actual,
            "unidad": "ppm",
            "ultima_actualizacion": ultima_actualizacion.isoformat() if ultima_actualizacion else None
        })
    
    return {"sensores": sensores_estado}


@app.get("/sesiones/historial")
def obtener_historial_sesiones(current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Obtener el historial de sesiones de captura del usuario"""
    
    # Obtener las últimas sesiones finalizadas que tengan datos reales
    sesiones = db.query(models.SesionCaptura).filter(
        models.SesionCaptura.usuario_id == current_user.id,
        models.SesionCaptura.activo == False,
        models.SesionCaptura.finalizado_en.isnot(None),
        models.SesionCaptura.total_lecturas > 0  # Solo sesiones con datos
    ).order_by(models.SesionCaptura.finalizado_en.desc()).limit(10).all()
    
    resultado = []
    for sesion in sesiones:
        # Calcular duración
        duracion = None
        if sesion.finalizado_en and sesion.iniciado_en:
            diff = sesion.finalizado_en - sesion.iniciado_en
            horas = diff.total_seconds() // 3600
            minutos = (diff.total_seconds() % 3600) // 60
            if horas > 0:
                duracion = f"{int(horas)}h {int(minutos)}m"
            else:
                duracion = f"{int(minutos)}m"
        
        # Obtener estadísticas de lecturas para esta sesión
        estadisticas = obtener_estadisticas_sesion(db, current_user.id, sesion.sensor_codigo, sesion.iniciado_en, sesion.finalizado_en)
        
        resultado.append({
            "id": sesion.id,
            "sensor_codigo": sesion.sensor_codigo,
            "iniciado_en": sesion.iniciado_en,
            "finalizado_en": sesion.finalizado_en,
            "duracion": duracion,
            "total_lecturas": sesion.total_lecturas,
            "promedio_valor": estadisticas.get("promedio"),
            "max_valor": estadisticas.get("maximo"),
            "min_valor": estadisticas.get("minimo")
        })
    
    return resultado


@app.post("/sesiones/limpiar-vacias")
def limpiar_sesiones_vacias(current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Limpiar sesiones vacías (sin lecturas) del usuario"""
    
    # Eliminar sesiones finalizadas sin lecturas
    sesiones_vacias = db.query(models.SesionCaptura).filter(
        models.SesionCaptura.usuario_id == current_user.id,
        models.SesionCaptura.activo == False,
        models.SesionCaptura.total_lecturas == 0
    ).all()
    
    sesiones_eliminadas = len(sesiones_vacias)
    
    for sesion in sesiones_vacias:
        db.delete(sesion)
    
    db.commit()
    
    return {
        "mensaje": f"Se eliminaron {sesiones_eliminadas} sesiones vacías",
        "sesiones_eliminadas": sesiones_eliminadas
    }


@app.get("/sesiones/ultima")
def obtener_ultima_sesion_consolidada(current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Obtener la última sesión consolidada del usuario"""
    
    # Obtener las últimas sesiones finalizadas de cada sensor que tengan datos
    sesiones_mq135 = db.query(models.SesionCaptura).filter(
        models.SesionCaptura.usuario_id == current_user.id,
        models.SesionCaptura.sensor_codigo == 'mq135',
        models.SesionCaptura.activo == False,
        models.SesionCaptura.finalizado_en.isnot(None),
        models.SesionCaptura.total_lecturas > 0
    ).order_by(models.SesionCaptura.finalizado_en.desc()).first()
    
    sesiones_mq4 = db.query(models.SesionCaptura).filter(
        models.SesionCaptura.usuario_id == current_user.id,
        models.SesionCaptura.sensor_codigo == 'mq4',
        models.SesionCaptura.activo == False,
        models.SesionCaptura.finalizado_en.isnot(None),
        models.SesionCaptura.total_lecturas > 0
    ).order_by(models.SesionCaptura.finalizado_en.desc()).first()
    
    sesiones_mq7 = db.query(models.SesionCaptura).filter(
        models.SesionCaptura.usuario_id == current_user.id,
        models.SesionCaptura.sensor_codigo == 'mq7',
        models.SesionCaptura.activo == False,
        models.SesionCaptura.finalizado_en.isnot(None),
        models.SesionCaptura.total_lecturas > 0
    ).order_by(models.SesionCaptura.finalizado_en.desc()).first()
    
    # Encontrar la sesión más reciente entre todas
    sesiones_existentes = [s for s in [sesiones_mq135, sesiones_mq4, sesiones_mq7] if s is not None]
    
    if not sesiones_existentes:
        return {
            "iniciado_en": None,
            "finalizado_en": None,
            "duracion": "0m",
            "total_lecturas": 0,
            "sensores_activos": 0,
            "sensores": []
        }
    
    # Encontrar la sesión más reciente
    ultima_sesion = max(sesiones_existentes, key=lambda x: x.finalizado_en)
    
    # Calcular duración
    duracion = "0m"
    if ultima_sesion.finalizado_en and ultima_sesion.iniciado_en:
        diff = ultima_sesion.finalizado_en - ultima_sesion.iniciado_en
        horas = diff.total_seconds() // 3600
        minutos = (diff.total_seconds() % 3600) // 60
        if horas > 0:
            duracion = f"{int(horas)}h {int(minutos)}m"
        else:
            duracion = f"{int(minutos)}m"
    
    # Calcular total de lecturas y sensores activos
    total_lecturas = 0
    sensores_activos = 0
    sensores = []
    
    for sesion in [sesiones_mq135, sesiones_mq4, sesiones_mq7]:
        if sesion:
            sensores_activos += 1
            total_lecturas += sesion.total_lecturas or 0
            
            # Obtener estadísticas
            estadisticas = obtener_estadisticas_sesion(db, current_user.id, sesion.sensor_codigo, sesion.iniciado_en, sesion.finalizado_en)
            
            sensores.append({
                "sensor_codigo": sesion.sensor_codigo,
                "total_lecturas": sesion.total_lecturas or 0,
                "promedio_valor": estadisticas.get("promedio", 0),
                "max_valor": estadisticas.get("maximo", 0),
                "min_valor": estadisticas.get("minimo", 0)
            })
    
    return {
        "iniciado_en": ultima_sesion.iniciado_en,
        "finalizado_en": ultima_sesion.finalizado_en,
        "duracion": duracion,
        "total_lecturas": total_lecturas,
        "sensores_activos": sensores_activos,
        "sensores": sensores
    }


def obtener_estadisticas_sesion(db: Session, usuario_id: int, sensor_codigo: str, inicio, fin):
    """Obtener estadísticas de lecturas para una sesión específica"""
    
    # Determinar qué tabla usar según el sensor
    if sensor_codigo == 'mq135':
        tabla = models.LecturaMQ135
    elif sensor_codigo == 'mq4':
        tabla = models.LecturaMQ4
    elif sensor_codigo == 'mq7':
        tabla = models.LecturaMQ7
    else:
        return {"promedio": None, "maximo": None, "minimo": None}
    
    # Obtener lecturas en el rango de tiempo de la sesión
    lecturas = db.query(tabla).filter(
        tabla.usuario_id == usuario_id,
        tabla.creado_en >= inicio,
        tabla.creado_en <= fin
    ).all()
    
    if not lecturas:
        return {"promedio": None, "maximo": None, "minimo": None}
    
    valores = [l.valor for l in lecturas]
    
    return {
        "promedio": round(sum(valores) / len(valores), 2),
        "maximo": max(valores),
        "minimo": min(valores)
    }


# ----------- NOTIFICACIONES -----------

@app.get("/notificaciones/me", response_model=list[schemas.NotificacionOut])
def obtener_mis_notificaciones(current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Obtener notificaciones del usuario actual"""
    notificaciones = db.query(models.Notificacion).filter(
        models.Notificacion.usuario_id == current_user.id
    ).order_by(models.Notificacion.creado_en.desc()).limit(50).all()
    
    return notificaciones


@app.get("/notificaciones/admin", response_model=list[schemas.NotificacionOut])
def obtener_notificaciones_admin(
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db),
    limit: int = 100000,
    order: str = "asc"
):
    """Obtener notificaciones para admin con orden y límite opcional"""
    q = db.query(models.Notificacion)
    # Orden configurable, por defecto ID ascendente
    if (order or "").lower() == "desc":
        q = q.order_by(models.Notificacion.id.desc())
    else:
        q = q.order_by(models.Notificacion.id.asc())
    if limit and limit > 0:
        q = q.limit(limit)
    return q.all()


@app.post("/notificaciones", response_model=schemas.NotificacionOut)
def crear_notificacion_admin(
    notificacion: schemas.NotificacionCreate,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Crear una notificación (solo admin)"""
    nueva = models.Notificacion(
        usuario_id=notificacion.usuario_id,
        sensor_codigo=notificacion.sensor_codigo,
        valor=notificacion.valor,
        estado=notificacion.estado.value,
        titulo=notificacion.titulo,
        mensaje=notificacion.mensaje,
        tipo=notificacion.tipo.value,
        leida=bool(notificacion.leida or False)
    )
    if nueva.leida:
        nueva.leido_en = func.now()
    db.add(nueva)
    db.commit()
    db.refresh(nueva)
    return nueva


@app.put("/notificaciones/leer-todas")
def marcar_todas_notificaciones_leidas(current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Marcar todas las notificaciones del usuario como leídas"""
    print(f"🔔 Backend: Usuario {current_user.email} (ID: {current_user.id}) intentando marcar todas como leídas")
    
    # Contar notificaciones no leídas antes
    notificaciones_no_leidas = db.query(models.Notificacion).filter(
        models.Notificacion.usuario_id == current_user.id,
        models.Notificacion.leida == False
    ).count()
    
    print(f"🔔 Backend: Encontradas {notificaciones_no_leidas} notificaciones no leídas para el usuario")
    
    # Marcar como leídas
    result = db.query(models.Notificacion).filter(
        models.Notificacion.usuario_id == current_user.id,
        models.Notificacion.leida == False
    ).update({
        "leida": True,
        "leido_en": func.now()
    })
    
    db.commit()
    print(f"✅ Backend: Marcadas {result} notificaciones como leídas")
    
    return {"mensaje": "Todas las notificaciones marcadas como leídas", "marcadas": result}

@app.put("/notificaciones/{notificacion_id}", response_model=schemas.NotificacionOut)
def actualizar_notificacion_admin(
    notificacion_id: int,
    cambios: schemas.NotificacionUpdate,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Actualizar una notificación (solo admin)"""
    notif = db.query(models.Notificacion).filter(models.Notificacion.id == notificacion_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    data = cambios.dict(exclude_unset=True)
    # map enums to string
    if 'estado' in data and data['estado'] is not None:
        data['estado'] = data['estado'].value
    if 'tipo' in data and data['tipo'] is not None:
        data['tipo'] = data['tipo'].value
    for field, value in data.items():
        setattr(notif, field, value)
    if 'leida' in data:
        notif.leido_en = func.now() if data['leida'] else None
    db.commit()
    db.refresh(notif)
    return notif

@app.put("/notificaciones/{notificacion_id}/leer")
def marcar_notificacion_leida(notificacion_id: int, current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Marcar una notificación como leída"""
    notificacion = db.query(models.Notificacion).filter(
        models.Notificacion.id == notificacion_id,
        models.Notificacion.usuario_id == current_user.id
    ).first()
    
    if not notificacion:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    
    notificacion.leida = True
    notificacion.leido_en = func.now()
    db.commit()
    
    return {"mensaje": "Notificación marcada como leída"}




@app.delete("/notificaciones/{notificacion_id}")
def eliminar_notificacion(notificacion_id: int, current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Eliminar una notificación. Admin puede eliminar cualquiera; usuario solo las suyas."""
    query = db.query(models.Notificacion).filter(models.Notificacion.id == notificacion_id)
    if current_user.rol.value != "admin":
        query = query.filter(models.Notificacion.usuario_id == current_user.id)
    notificacion = query.first()
    
    if not notificacion:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    
    db.delete(notificacion)
    db.commit()
    
    return {"mensaje": "Notificación eliminada"}




# ----------- CONFIGURACIÓN DE NOTIFICACIONES -----------

@app.get("/configuracion-notificaciones/me", response_model=schemas.ConfiguracionNotificacionesOut)
def obtener_configuracion_notificaciones(current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Obtener configuración de notificaciones del usuario"""
    config = db.query(models.ConfiguracionNotificaciones).filter(
        models.ConfiguracionNotificaciones.usuario_id == current_user.id
    ).first()
    
    if not config:
        # Crear configuración por defecto si no existe
        config = models.ConfiguracionNotificaciones(
            usuario_id=current_user.id,
            notify_mq135_good=False,
            notify_mq135_warning=True,
            notify_mq135_bad=True,
            notify_mq7_good=False,
            notify_mq7_warning=True,
            notify_mq7_bad=True,
            notify_mq4_good=False,
            notify_mq4_warning=True,
            notify_mq4_bad=True
        )
        db.add(config)
        db.commit()
        db.refresh(config)
    
    return config


# ----------- CONFIGURACIÓN GLOBAL DEL SISTEMA -----------
@app.get("/configuracion-sistema", response_model=schemas.ConfiguracionSistemaOut)
def obtener_configuracion_sistema(current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    cfg = db.query(models.ConfiguracionSistema).first()
    if not cfg:
        cfg = models.ConfiguracionSistema()
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


@app.put("/configuracion-sistema", response_model=schemas.ConfiguracionSistemaOut)
def actualizar_configuracion_sistema(payload: schemas.ConfiguracionSistemaUpdate, current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    cfg = db.query(models.ConfiguracionSistema).first()
    if not cfg:
        cfg = models.ConfiguracionSistema()
        db.add(cfg)
    data = payload.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(cfg, k, v)
    cfg.actualizado_en = func.now()
    db.commit()
    db.refresh(cfg)
    # Opcional: reflejar el cambio SOLO para el admin actual en configuracion_usuario
    try:
        if 'prolongar_sesion' in data:
            cu = db.query(models.ConfiguracionUsuario).filter(
                models.ConfiguracionUsuario.usuario_id == current_user.id
            ).first()
            if not cu:
                cu = models.ConfiguracionUsuario(usuario_id=current_user.id)
                db.add(cu)
            cu.prolongar_sesion = bool(data['prolongar_sesion'])
            cu.actualizado_en = func.now()
            db.commit()
    except Exception:
        pass
    # invalidar cache en auth si existe
    try:
        from auth import invalidate_config_cache
        invalidate_config_cache()
    except Exception:
        pass
    return cfg


# ----------- CONFIGURACIÓN POR USUARIO (PROLONGAR SESIÓN) -----------
@app.get("/configuracion-sesion/me", response_model=schemas.ConfiguracionUsuarioOut)
def obtener_config_sesion_usuario(current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    cfg = db.query(models.ConfiguracionUsuario).filter(models.ConfiguracionUsuario.usuario_id == current_user.id).first()
    if not cfg:
        cfg = models.ConfiguracionUsuario(usuario_id=current_user.id, prolongar_sesion=False)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


@app.put("/configuracion-sesion/me", response_model=schemas.ConfiguracionUsuarioOut)
def actualizar_config_sesion_usuario(payload: schemas.ConfiguracionUsuarioUpdate, current_user: models.Usuario = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    cfg = db.query(models.ConfiguracionUsuario).filter(models.ConfiguracionUsuario.usuario_id == current_user.id).first()
    if not cfg:
        cfg = models.ConfiguracionUsuario(usuario_id=current_user.id)
        db.add(cfg)
    data = payload.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(cfg, k, v)
    cfg.actualizado_en = func.now()
    db.commit()
    db.refresh(cfg)
    return cfg


@app.put("/admin/configuracion-sesion/{usuario_id}", response_model=schemas.ConfiguracionUsuarioOut)
def admin_actualizar_config_sesion_usuario(usuario_id: int, payload: schemas.ConfiguracionUsuarioUpdate, current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    # Verificar usuario existe
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    cfg = db.query(models.ConfiguracionUsuario).filter(models.ConfiguracionUsuario.usuario_id == usuario_id).first()
    if not cfg:
        cfg = models.ConfiguracionUsuario(usuario_id=usuario_id)
        db.add(cfg)
    data = payload.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(cfg, k, v)
    cfg.actualizado_en = func.now()
    db.commit()
    db.refresh(cfg)
    return cfg


@app.get("/admin/configuracion-sesion/{usuario_id}", response_model=schemas.ConfiguracionUsuarioOut)
def admin_obtener_config_sesion_usuario(usuario_id: int, current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    cfg = db.query(models.ConfiguracionUsuario).filter(models.ConfiguracionUsuario.usuario_id == usuario_id).first()
    if not cfg:
        cfg = models.ConfiguracionUsuario(usuario_id=usuario_id, prolongar_sesion=False)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


# ----------- LISTADO ADMIN: USUARIOS + SESIÓN + PROLONGACIÓN -----------
@app.get("/admin/usuarios-sesion", response_model=list[dict])
def listar_usuarios_sesion(
    q: str | None = None,
    rol: str | None = None,
    prolongar: bool | None = None,
    activa: bool | None = None,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    usuarios = db.query(models.Usuario).all()
    resultado = []
    for u in usuarios:
        # Config por usuario
        cfg = db.query(models.ConfiguracionUsuario).filter(models.ConfiguracionUsuario.usuario_id == u.id).first()
        prolongar_sesion = bool(getattr(cfg, 'prolongar_sesion', False)) if cfg else False
        # Sesión activa
        try:
            ses_act = db.query(models.SesionUsuario).filter(
                models.SesionUsuario.usuario_id == u.id,
                models.SesionUsuario.activo == True
            ).first()
            esta_activa = ses_act is not None
        except Exception:
            esta_activa = False
        item = {
            "id": u.id,
            "nombre": u.nombre,
            "email": u.email,
            "rol": u.rol.value if hasattr(u.rol, 'value') else str(u.rol),
            "prolongar_sesion": prolongar_sesion,
            "sesion_activa": esta_activa,
        }
        resultado.append(item)

    # Filtros en memoria (datasets esperados pequeños)
    if q:
        term = q.lower()
        resultado = [r for r in resultado if term in r["nombre"].lower() or term in r["email"].lower()]
    if rol:
        resultado = [r for r in resultado if r["rol"] == rol]
    if prolongar is not None:
        resultado = [r for r in resultado if r["prolongar_sesion"] == prolongar]
    if activa is not None:
        resultado = [r for r in resultado if r["sesion_activa"] == activa]

    # Orden básico por id
    resultado.sort(key=lambda x: x["id"]) 
    return resultado


# ----------- REPORTES PARA USUARIO (FILTRABLES) -----------

from typing import Optional

@app.get("/reportes/me")
def obtener_reportes_usuario(
    desde: Optional[str] = None,
    hasta: Optional[str] = None,
    sensores: Optional[str] = None,  # csv: mq135,mq4,mq7
    severidades: Optional[str] = None,  # csv: bueno,advertencia,malo
    limit: Optional[int] = None,
    current_user: models.Usuario = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Devuelve lecturas del usuario autenticado con filtros por rango de fechas,
    sensores seleccionados y severidades. Estructura por sensor.
    Fechas en ISO 8601 (ej: 2025-09-01T00:00:00 o 2025-09-01).
    """
    from datetime import datetime

    # Restringir estrictamente al rol usuario
    if getattr(current_user.rol, "value", str(current_user.rol)) != "usuario":
        raise HTTPException(status_code=403, detail="Se requiere rol de usuario")

    sensores_req = {s.strip().lower() for s in (sensores.split(",") if sensores else ["mq135", "mq4", "mq7"]) if s.strip()}
    severidades_req = {s.strip().lower() for s in (severidades.split(",") if severidades else ["bueno", "advertencia", "malo"]) if s.strip()}

    # Parseo de fechas flexible
    def parse_fecha(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            try:
                return datetime.fromisoformat(value + "T00:00:00")
            except Exception:
                raise HTTPException(status_code=400, detail="Formato de fecha inválido")

    fecha_desde = parse_fecha(desde)
    fecha_hasta = parse_fecha(hasta)

    def filtrar_query(tabla):
        q = db.query(tabla).filter(tabla.usuario_id == current_user.id)
        if fecha_desde is not None:
            q = q.filter(tabla.creado_en >= fecha_desde)
        if fecha_hasta is not None:
            q = q.filter(tabla.creado_en <= fecha_hasta)
        # Filtro de severidades (compat con Enum)
        try:
            estados = [models.EstadoLecturaEnum(s) for s in severidades_req]
            q = q.filter(tabla.estado.in_(estados))
        except Exception:
            raise HTTPException(status_code=400, detail="Severidad inválida")
        q = q.order_by(tabla.creado_en.desc())
        if limit and limit > 0:
            q = q.limit(limit)
        return q

    resultado = {"mq135": [], "mq4": [], "mq7": []}

    if "mq135" in sensores_req:
        for l in filtrar_query(models.LecturaMQ135).all():
            resultado["mq135"].append({
                "id": l.id,
                "valor": l.valor,
                "estado": getattr(l.estado, "value", str(l.estado)),
                "creado_en": l.creado_en
            })

    if "mq4" in sensores_req:
        for l in filtrar_query(models.LecturaMQ4).all():
            resultado["mq4"].append({
                "id": l.id,
                "valor": l.valor,
                "estado": getattr(l.estado, "value", str(l.estado)),
                "creado_en": l.creado_en
            })

    if "mq7" in sensores_req:
        for l in filtrar_query(models.LecturaMQ7).all():
            resultado["mq7"].append({
                "id": l.id,
                "valor": l.valor,
                "estado": getattr(l.estado, "value", str(l.estado)),
                "creado_en": l.creado_en
            })

    return resultado
@app.put("/configuracion-notificaciones/me", response_model=schemas.ConfiguracionNotificacionesOut)
def actualizar_configuracion_notificaciones(
    config_update: schemas.ConfiguracionNotificacionesUpdate,
    current_user: models.Usuario = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Actualizar configuración de notificaciones del usuario"""
    config = db.query(models.ConfiguracionNotificaciones).filter(
        models.ConfiguracionNotificaciones.usuario_id == current_user.id
    ).first()
    
    if not config:
        # Crear configuración si no existe
        config = models.ConfiguracionNotificaciones(usuario_id=current_user.id)
        db.add(config)
    
    # Actualizar solo los campos proporcionados
    update_data = config_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)
    
    config.actualizado_en = func.now()
    db.commit()
    db.refresh(config)
    
    return config


# Endpoints de configuración de notificaciones para ADMIN sobre cualquier usuario
@app.get("/admin/configuracion-notificaciones/{usuario_id}", response_model=schemas.ConfiguracionNotificacionesOut)
def obtener_configuracion_notificaciones_usuario(
    usuario_id: int,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Obtener configuración de notificaciones de un usuario específico (solo admin)."""
    # Verificar usuario
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    config = db.query(models.ConfiguracionNotificaciones).filter(
        models.ConfiguracionNotificaciones.usuario_id == usuario_id
    ).first()

    if not config:
        # Crear config por defecto si no existe
        config = models.ConfiguracionNotificaciones(
            usuario_id=usuario_id,
            notify_mq135_good=False,
            notify_mq135_warning=True,
            notify_mq135_bad=True,
            notify_mq7_good=False,
            notify_mq7_warning=True,
            notify_mq7_bad=True,
            notify_mq4_good=False,
            notify_mq4_warning=True,
            notify_mq4_bad=True
        )
        db.add(config)
        db.commit()
        db.refresh(config)

    return config


@app.put("/admin/configuracion-notificaciones/{usuario_id}", response_model=schemas.ConfiguracionNotificacionesOut)
def actualizar_configuracion_notificaciones_usuario(
    usuario_id: int,
    config_update: schemas.ConfiguracionNotificacionesUpdate,
    current_user: models.Usuario = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Actualizar configuración de notificaciones de un usuario específico (solo admin)."""
    # Verificar usuario
    usuario = db.query(models.Usuario).filter(models.Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    config = db.query(models.ConfiguracionNotificaciones).filter(
        models.ConfiguracionNotificaciones.usuario_id == usuario_id
    ).first()

    if not config:
        config = models.ConfiguracionNotificaciones(usuario_id=usuario_id)
        db.add(config)

    update_data = config_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)

    config.actualizado_en = func.now()
    db.commit()
    db.refresh(config)
    return config

def crear_notificacion_si_necesario(db: Session, usuario_id: int, sensor_codigo: str, valor: float, estado: str):
    """Función para crear notificación si el usuario la tiene configurada"""
    
    # Obtener configuración del usuario
    config = db.query(models.ConfiguracionNotificaciones).filter(
        models.ConfiguracionNotificaciones.usuario_id == usuario_id
    ).first()
    
    if not config:
        return  # No hay configuración, no crear notificación
    
    # Determinar si debe crear notificación según la configuración
    should_notify = False
    tipo = "info"
    titulo = ""
    mensaje = ""
    
    if sensor_codigo == "mq135":
        estado = calcular_severidad_dinamica(sensor_codigo, valor, db)
        if estado == "bueno" and config.notify_mq135_good:
            should_notify = True
            tipo = "info"
            titulo = "Calidad del aire buena"
            mensaje = "Los niveles de CO₂ están en rango normal"
        elif estado == "advertencia" and config.notify_mq135_warning:
            should_notify = True
            tipo = "warning"
            titulo = "Advertencia de calidad del aire"
            mensaje = "Los niveles de CO₂ están elevados"
        elif estado == "malo" and config.notify_mq135_bad:
            should_notify = True
            tipo = "danger"
            titulo = "Alerta de calidad del aire"
            mensaje = "Los niveles de CO₂ son peligrosos"
    
    elif sensor_codigo == "mq7":
        estado = calcular_severidad_dinamica(sensor_codigo, valor, db)
        if estado == "bueno" and config.notify_mq7_good:
            should_notify = True
            tipo = "info"
            titulo = "Monóxido de carbono normal"
            mensaje = "Los niveles de CO están en rango seguro"
        elif estado == "advertencia" and config.notify_mq7_warning:
            should_notify = True
            tipo = "warning"
            titulo = "Advertencia de monóxido de carbono"
            mensaje = "Los niveles de CO están elevados"
        elif estado == "malo" and config.notify_mq7_bad:
            should_notify = True
            tipo = "danger"
            titulo = "Alerta de monóxido de carbono"
            mensaje = "Los niveles de CO son peligrosos"
    
    elif sensor_codigo == "mq4":
        estado = calcular_severidad_dinamica(sensor_codigo, valor, db)
        if estado == "bueno" and config.notify_mq4_good:
            should_notify = True
            tipo = "info"
            titulo = "Metano normal"
            mensaje = "Los niveles de metano están en rango seguro"
        elif estado == "advertencia" and config.notify_mq4_warning:
            should_notify = True
            tipo = "warning"
            titulo = "Advertencia de metano"
            mensaje = "Los niveles de metano están elevados"
        elif estado == "malo" and config.notify_mq4_bad:
            should_notify = True
            tipo = "danger"
            titulo = "Alerta de metano"
            mensaje = "Los niveles de metano son peligrosos"
    
    if should_notify:
        # Crear la notificación
        notificacion = models.Notificacion(
            usuario_id=usuario_id,
            sensor_codigo=sensor_codigo,
            valor=valor,
            estado=estado,
            titulo=titulo,
            mensaje=mensaje,
            tipo=tipo,
            leida=False
        )
        db.add(notificacion)
        db.commit()


# ---------- ALERTAS PERSONALIZADAS: evaluación de triggers ----------
def _trigger_matches(valor: float, umbral: float | None, tipo: str) -> bool:
    if umbral is None:
        return False
    try:
        v = float(valor)
        u = float(umbral)
    except Exception:
        return False
    t = (tipo or 'igual').lower()
    if t == 'igual':
        return v == u
    if t == 'mayor_igual':
        return v >= u
    if t == 'menor_igual':
        return v <= u
    return False

def evaluar_alerta_personalizada(db: Session, usuario_id: int, sensor_codigo: str, valor: float):
    cfg = db.query(models.ConfiguracionSistema).first()
    if not cfg:
        return
    if sensor_codigo == 'mq135':
        umbral, tipo = getattr(cfg, 'mq135_trigger_valor', None), getattr(cfg, 'mq135_trigger_tipo', 'igual')
    elif sensor_codigo == 'mq4':
        umbral, tipo = getattr(cfg, 'mq4_trigger_valor', None), getattr(cfg, 'mq4_trigger_tipo', 'igual')
    elif sensor_codigo == 'mq7':
        umbral, tipo = getattr(cfg, 'mq7_trigger_valor', None), getattr(cfg, 'mq7_trigger_tipo', 'igual')
    else:
        return

    if not _trigger_matches(valor, umbral, tipo):
        return

    # Calcular severidad con umbrales dinámicos
    sev = calcular_severidad_dinamica(sensor_codigo, valor, db)
    alerta = models.AlertaPersonalizada(
        usuario_id=usuario_id,
        sensor_codigo=sensor_codigo,
        valor=float(valor),
        umbral_usado=float(umbral) if umbral is not None else None,
        tipo_trigger=str(tipo or 'igual'),
        severidad_calculada=sev
    )
    db.add(alerta)
    db.commit()


# ----------- DASHBOARD STATISTICS -----------

@app.get("/admin/dashboard/stats")
def get_dashboard_stats(current_user: models.Usuario = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Obtener estadísticas para el dashboard del admin"""
    
    # Contar usuarios (solo usuarios regulares, no admins)
    total_users = db.query(models.Usuario).filter(models.Usuario.rol == 'usuario').count()
    
    # Contar sensores (asumiendo 3 sensores: MQ135, MQ4, MQ7)
    total_sensors = 3
    
    # Contar total de datos recopilados (suma de todas las lecturas)
    total_mq135 = db.query(models.LecturaMQ135).count()
    total_mq4 = db.query(models.LecturaMQ4).count()
    total_mq7 = db.query(models.LecturaMQ7).count()
    total_data_points = total_mq135 + total_mq4 + total_mq7
    
    # Contar notificaciones activas (no leídas)
    active_notifications = db.query(models.Notificacion).filter(models.Notificacion.leida == False).count()
    
    return {
        "total_users": total_users,
        "total_sensors": total_sensors,
        "total_data_points": total_data_points,
        "active_notifications": active_notifications
    }



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
