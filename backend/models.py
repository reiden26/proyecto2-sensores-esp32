from sqlalchemy import Column, Integer, String, Enum, DateTime, func, ForeignKey, Float, UniqueConstraint, Boolean
from sqlalchemy.orm import relationship
from database import Base
import enum

# Definimos los roles como Enum en Python
class RolEnum(enum.Enum):
    usuario = "usuario"
    admin = "admin"

class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, nullable=False, index=True)
    password = Column(String(255), nullable=False)
    rol = Column(Enum(RolEnum), default=RolEnum.usuario, nullable=False, server_default='usuario')
    imagen_url = Column(String(500), default='https://res.cloudinary.com/duzmmuisk/image/upload/v1758840939/default_qljbtb.svg', nullable=True)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())
    actualizado_en = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
    
    # Relaciones con notificaciones
    notificaciones = relationship("Notificacion", back_populates="usuario", cascade="all, delete-orphan")
    configuracion_notificaciones = relationship("ConfiguracionNotificaciones", back_populates="usuario", uselist=False, cascade="all, delete-orphan")


# --------- Sensores y Lecturas ---------

class Sensor(Base):
    __tablename__ = "sensores"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String(20), nullable=False, unique=True, index=True)  # mq135 | mq4 | mq7
    nombre = Column(String(50), nullable=False)
    descripcion = Column(String(255), nullable=True)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())


class UsuarioSensor(Base):
    __tablename__ = "usuarios_sensores"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    sensor_id = Column(Integer, ForeignKey("sensores.id", ondelete="CASCADE"), nullable=False)
    asignado_en = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("usuario_id", "sensor_id", name="uq_usuario_sensor"),)


class EstadoLecturaEnum(enum.Enum):
    bueno = "bueno"
    advertencia = "advertencia"
    malo = "malo"


# Tablas individuales para cada sensor
class LecturaMQ135(Base):
    __tablename__ = "lecturas_mq135"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    valor = Column(Float, nullable=False)
    estado = Column(Enum(EstadoLecturaEnum), nullable=False)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())


class LecturaMQ4(Base):
    __tablename__ = "lecturas_mq4"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    valor = Column(Float, nullable=False)
    estado = Column(Enum(EstadoLecturaEnum), nullable=False)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())


class LecturaMQ7(Base):
    __tablename__ = "lecturas_mq7"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    valor = Column(Float, nullable=False)
    estado = Column(Enum(EstadoLecturaEnum), nullable=False)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())


class SensoresActivos(Base):
    __tablename__ = "sensores_activos"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, unique=True)
    mq135_activo = Column(Boolean, nullable=False, server_default="0")
    mq4_activo = Column(Boolean, nullable=False, server_default="0")
    mq7_activo = Column(Boolean, nullable=False, server_default="0")
    actualizado_en = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SesionCaptura(Base):
    __tablename__ = "sesiones_captura"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    sensor_codigo = Column(String(20), nullable=False)  # mq135, mq4, mq7
    iniciado_en = Column(DateTime(timezone=True), server_default=func.now())
    finalizado_en = Column(DateTime(timezone=True), nullable=True)
    activo = Column(Boolean, nullable=False, server_default="1")
    total_lecturas = Column(Integer, nullable=False, server_default="0")


class SesionUsuario(Base):
    __tablename__ = "sesiones_usuario"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    inicio = Column(DateTime(timezone=True), server_default=func.now())
    fin = Column(DateTime(timezone=True), nullable=True)
    activo = Column(Boolean, nullable=False, server_default="1")
    token_jti = Column(String(255), nullable=True)  # JWT ID único


# --------- Notificaciones ---------

class Notificacion(Base):
    __tablename__ = "notificaciones"
    
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    sensor_codigo = Column(String(10), nullable=False)  # 'mq135', 'mq7', 'mq4'
    valor = Column(Float, nullable=False)
    estado = Column(String(20), nullable=False)  # 'bueno', 'advertencia', 'malo'
    titulo = Column(String(255), nullable=False)
    mensaje = Column(String(500), nullable=False)
    tipo = Column(String(20), nullable=False)  # 'info', 'warning', 'danger'
    leida = Column(Boolean, default=False)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())
    leido_en = Column(DateTime(timezone=True), nullable=True)
    
    # Relación con usuario
    usuario = relationship("Usuario", back_populates="notificaciones")


class ConfiguracionNotificaciones(Base):
    __tablename__ = "configuracion_notificaciones"
    
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, unique=True)
    
    # Configuraciones MQ-135
    notify_mq135_good = Column(Boolean, default=False)
    notify_mq135_warning = Column(Boolean, default=True)
    notify_mq135_bad = Column(Boolean, default=True)
    
    # Configuraciones MQ-7
    notify_mq7_good = Column(Boolean, default=False)
    notify_mq7_warning = Column(Boolean, default=True)
    notify_mq7_bad = Column(Boolean, default=True)
    
    # Configuraciones MQ-4
    notify_mq4_good = Column(Boolean, default=False)
    notify_mq4_warning = Column(Boolean, default=True)
    notify_mq4_bad = Column(Boolean, default=True)
    
    creado_en = Column(DateTime(timezone=True), server_default=func.now())
    actualizado_en = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relación con usuario
    usuario = relationship("Usuario", back_populates="configuracion_notificaciones")

# Nueva tabla: configuración global del sistema
class ConfiguracionSistema(Base):
    __tablename__ = "configuracion_sistema"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    prolongar_sesion = Column(Boolean, default=False, nullable=False)
    actualizado_en = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    # Umbrales globales de severidad para sensores (configurables por admin)
    # Ajustados a valores realistas según estándares de calidad del aire
    # NOTA: MQ-135 mide calidad del aire general (NH3, NOx, alcohol, benceno, humo), NO CO₂ específico
    mq135_warning_threshold = Column(Float, nullable=False, server_default="20")   # Calidad aire: advertencia desde 20 ppm
    mq135_bad_threshold = Column(Float, nullable=False, server_default="50")      # Calidad aire: malo desde 50 ppm

    mq4_warning_threshold = Column(Float, nullable=False, server_default="10")      # Metano: advertencia desde 10 ppm
    mq4_bad_threshold = Column(Float, nullable=False, server_default="50")          # Metano: malo desde 50 ppm (riesgo)

    mq7_warning_threshold = Column(Float, nullable=False, server_default="9")       # CO: advertencia desde 9 ppm
    mq7_bad_threshold = Column(Float, nullable=False, server_default="35")         # CO: malo desde 35 ppm

    # Triggers personalizados por sensor (valor y tipo de comparación)
    mq135_trigger_valor = Column(Float, nullable=True)
    mq135_trigger_tipo = Column(String(20), nullable=False, server_default="igual")  # igual|mayor_igual|menor_igual
    mq4_trigger_valor = Column(Float, nullable=True)
    mq4_trigger_tipo = Column(String(20), nullable=False, server_default="igual")
    mq7_trigger_valor = Column(Float, nullable=True)
    mq7_trigger_tipo = Column(String(20), nullable=False, server_default="igual")


class AlertaPersonalizada(Base):
    __tablename__ = "alertas_personalizadas"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    sensor_codigo = Column(String(10), nullable=False)
    valor = Column(Float, nullable=False)
    umbral_usado = Column(Float, nullable=True)
    tipo_trigger = Column(String(20), nullable=False)  # igual|mayor_igual|menor_igual
    severidad_calculada = Column(String(20), nullable=True)  # bueno|advertencia|malo
    creado_en = Column(DateTime(timezone=True), server_default=func.now())

# Nueva tabla: configuración por usuario (prolongar sesión)
class ConfiguracionUsuario(Base):
    __tablename__ = "configuracion_usuario"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, unique=True)
    prolongar_sesion = Column(Boolean, default=False, nullable=False)
    actualizado_en = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    usuario = relationship("Usuario")
