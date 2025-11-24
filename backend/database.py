import pymysql
pymysql.install_as_MySQLdb()
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv


# Cargar las variables desde el archivo .env
# Prioridad: .env.local (desarrollo) > .env (producción)
if os.path.exists('.env.local'):
    load_dotenv('.env.local')
    print("🔧 Usando configuración local (.env.local)")
else:
    load_dotenv()
    print("🌐 Usando configuración de producción (.env)")

# Leer la URL de la base de datos (ahora desde Railway)
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# Si la URL viene con mysql://, cambiarla a mysql+pymysql://
if SQLALCHEMY_DATABASE_URL and SQLALCHEMY_DATABASE_URL.startswith("mysql://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("mysql://", "mysql+pymysql://", 1)
    print("✅ URL de base de datos configurada con PyMySQL")

# Crear el motor de conexión
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,  # mejora la estabilidad de conexión
)

# Crear la sesión
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base para los modelos
Base = declarative_base()


# Dependencia para obtener la sesión de BD
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()