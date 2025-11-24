import { Component, OnInit, OnDestroy, ChangeDetectorRef, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableDataSource } from '@angular/material/table';
import { MatInputModule } from '@angular/material/input';
import { ConfirmDeleteDialogComponent } from './confirm-delete-dialog.component';
import { NotificationService } from '../shared/notification/notification.service';
import { interval, Subscription } from 'rxjs';
import { ViewChild, AfterViewInit, inject } from '@angular/core';
import { environment } from '../../environments/environment';

interface SensorData {
  id: number;
  name: string;
  type: string;
  status: 'active' | 'inactive' | 'warning';
  lastValue: number;
  unit: string;
  lastUpdate: Date;
}

interface AlertData {
  id: number;
  sensor: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: Date;
  resolved: boolean;
}

interface AdminNotificacionRow {
  id: number;
  usuario_id: number;
  usuario_nombre?: string;
  sensor_codigo: string;
  valor: number;
  estado: 'bueno' | 'advertencia' | 'malo' | 'desconectado';
  titulo: string;
  mensaje: string;
  tipo: 'info' | 'warning' | 'danger';
  leida: boolean;
  creado_en: string;
  leido_en?: string | null;
}

interface UserActivity {
  id: number;
  name: string;
  role: string;
  lastLogin: Date;
  sensorsAssigned: number;
  sessionTime: number;
  recordsInSession: number;
  isOnline: boolean;
}

@Component({
  selector: 'app-admin-reports',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatTableModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatDividerModule,
    MatListModule,
    MatTabsModule,
    MatGridListModule,
    MatToolbarModule,
    MatMenuModule,
    MatTooltipModule,
    MatDialogModule,
    MatCheckboxModule,
    MatRadioModule,
    MatInputModule
  ],
  templateUrl: './admin-reports.component.html',
  styleUrls: ['./admin-reports.component.css']
})
export class AdminReportsComponent implements OnInit, OnDestroy, AfterViewInit {
  
  // Variables para datos de la API
  totalUsers: number = 0;
  adminUsers: number = 0;
  regularUsers: number = 0;
  
  // Variables para polling
  private pollingSubscription: Subscription | null = null;
  private pollingReportsSubscription: Subscription | null = null;
  isLoading: boolean = false;
  isLoadingAlerts: boolean = false;
  
  // Datos reales del backend
  dashboardData: any = null;
  temporalData: any = { hoy: 0, semana: 0, mes: 0 };
  alertasData: any[] = [];
  alertasFiltradas: any[] = [];
  alertasPaginadas: any[] = [];
  // Alertas personalizadas
  alertasPersonalizadasData: any[] = [];
  alertasPersonalizadasFiltradas: any[] = [];
  alertasPersonalizadasPaginadas: any[] = [];
  usuariosData: any = null;
  sensoresData: any[] = [];
  sensoresFiltrados: any[] = [];
  
  // Paginación para usuarios
  usuariosPaginados: any[] = [];
  usuariosPageSize = 5;
  usuariosCurrentPage = 0;
  usuariosTotalPages = 0;
  
  // Filtro de estado de conexión para usuarios
  selectedConnectionStatus: string = '';
  usuariosFiltrados: any[] = [];

  // Notificaciones admin
  notificacionesDataSource = new MatTableDataSource<AdminNotificacionRow>([]);
  notificacionesDisplayedColumns: string[] = ['id','usuario_id','sensor_codigo','valor','estado','titulo','tipo','leida','creado_en','acciones'];
  notifFiltroTexto: string = '';
  @ViewChild('notifPaginator') notifPaginator!: MatPaginator;
  mostrarFiltros: boolean = false;
  filtroTipo: string = '';
  filtroEstado: string = '';
  filtroSensor: string = '';
  private usuariosMap = new Map<number, string>();
  private usuariosSoloUsuario: { id: number; nombre: string }[] = [];
  isLoadingNotifs: boolean = false;

  // Paginación para alertas
  alertPageSize = 5;
  alertCurrentPage = 0;
  alertTotalPages = 0;
  pageSizeOptionsAlertas: number[] = [5, 10, 20, 100];
  
  // Datos simulados - Sensores específicos del proyecto
  sensors: SensorData[] = [
    { id: 1, name: 'MQ-135', type: 'Calidad del Aire', status: 'active', lastValue: 45.00, unit: 'ppm', lastUpdate: new Date() },
    { id: 2, name: 'MQ-7', type: 'Monóxido de Carbono', status: 'inactive', lastValue: 0.00, unit: 'ppm', lastUpdate: new Date() },
    { id: 3, name: 'MQ-4', type: 'Gas Metano', status: 'active', lastValue: 8.50, unit: 'ppm', lastUpdate: new Date() }
  ];

  alerts: AlertData[] = [
    { id: 1, sensor: 'MQ-135', message: 'Calidad del aire deteriorada', severity: 'low', timestamp: new Date(), resolved: true },
    { id: 2, sensor: 'MQ-7', message: 'Nivel de monóxido de carbono alto', severity: 'high', timestamp: new Date(), resolved: false },
    { id: 3, sensor: 'MQ-4', message: 'Concentración de metano detectada', severity: 'medium', timestamp: new Date(), resolved: false }
  ];

  userActivities: UserActivity[] = [
    { id: 1, name: 'Juan Pérez', role: 'Administrador', lastLogin: new Date(), sensorsAssigned: 8, sessionTime: 45, recordsInSession: 23, isOnline: true },
    { id: 2, name: 'María García', role: 'Usuario', lastLogin: new Date(), sensorsAssigned: 4, sessionTime: 23, recordsInSession: 12, isOnline: true },
    { id: 3, name: 'Carlos López', role: 'Usuario', lastLogin: new Date(), sensorsAssigned: 3, sessionTime: 12, recordsInSession: 8, isOnline: false },
    { id: 4, name: 'Ana Martínez', role: 'Usuario', lastLogin: new Date(), sensorsAssigned: 5, sessionTime: 67, recordsInSession: 31, isOnline: true }
  ];

  // Métricas del dashboard (se actualizarán con datos reales)
  totalSensors = 0;
  activeSensors = 0;
  inactiveSensors = 0;
  activeAlerts = 0;
  // Configuración de alertas (para tooltip)
  alertsConfig: any = null;

  // Filtros
  selectedSensor = '';
  selectedDateRange = 'today';
  selectedAlertSeverity = '';
  private filtroDesde?: Date;
  private filtroHasta?: Date;
  
  customDateRange = false;
  customDateFrom?: Date;
  customDateTo?: Date;

  // Datos simulados para gráficos - Sensores específicos
  pm25Data = [
    { time: '00:00', value: 18.2 },
    { time: '04:00', value: 22.1 },
    { time: '08:00', value: 28.5 },
    { time: '12:00', value: 35.3 },
    { time: '16:00', value: 31.7 },
    { time: '20:00', value: 25.8 }
  ];

  airQualityData = [
    { time: '00:00', value: 42 },
    { time: '04:00', value: 38 },
    { time: '08:00', value: 45 },
    { time: '12:00', value: 52 },
    { time: '16:00', value: 48 },
    { time: '20:00', value: 44 }
  ];

  methaneData = [
    { time: '00:00', value: 8.5 },
    { time: '04:00', value: 7.2 },
    { time: '08:00', value: 9.1 },
    { time: '12:00', value: 10.3 },
    { time: '16:00', value: 8.8 },
    { time: '20:00', value: 7.9 }
  ];

  // Copias originales para filtros
  private pm25DataOriginal: any[] = [];
  private airQualityDataOriginal: any[] = [];
  private methaneDataOriginal: any[] = [];

  // Lecturas crudas para recalcular series según rango
  private rawLecturas: { mq135: any[]; mq7: any[]; mq4: any[] } = { mq135: [], mq7: [], mq4: [] };

  coData = [
    { time: '00:00', value: 0.0 },
    { time: '04:00', value: 0.0 },
    { time: '08:00', value: 0.0 },
    { time: '12:00', value: 0.0 },
    { time: '16:00', value: 0.0 },
    { time: '20:00', value: 0.0 }
  ];

  // Carrusel de gráficas (3 sensores, mostrar 2 a la vez)
  chartIndex = 0; // índice del primer gráfico visible
  chartDefs = [
    { key: 'mq135', title: 'MQ-135 - Calidad del Aire - Últimas 24h', subtitle: 'Calidad del Aire - Últimas 24h', color: '#667eea', unit: 'μg/m³' },
    { key: 'mq7', title: 'MQ-7 - Monóxido de Carbono - Últimas 24h', subtitle: 'Monóxido de Carbono - Últimas 24h', color: '#f59e0b', unit: 'ppm' },
    { key: 'mq4', title: 'MQ-4 - Gas Metano - Últimas 24h', subtitle: 'Gas Metano - Últimas 24h', color: '#ef4444', unit: 'ppm' }
  ];
  animationClass = '';

  private notificationService = inject(NotificationService);

  constructor(
    private http: HttpClient, 
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadAllData();
    this.startPolling();
    // Escuchar eventos de actualización del usuario para sincronizar imágenes
    window.addEventListener('userUpdated', this.onUserUpdated.bind(this));
  }

  ngOnDestroy(): void {
    this.stopPolling();
    // Remover listener de eventos de usuario
    window.removeEventListener('userUpdated', this.onUserUpdated.bind(this));
  }

  ngAfterViewInit(): void {
    // asociar paginador cuando esté disponible
    if (this.notifPaginator) {
      this.notificacionesDataSource.paginator = this.notifPaginator;
    }
    // asegurar filtro reactivo usa un objeto; Angular requiere cambio de referencia
    this.notificacionesDataSource.filterPredicate = (row, filter) => {
      try {
        const f = JSON.parse(filter || '{}');
        const txt = (f.txt || '').toLowerCase();
        const tipo = (f.tipo || '').toLowerCase();
        const estado = (f.estado || '').toLowerCase();
        const sensor = (f.sensor || '').toLowerCase();
        const blob = `${row.id} ${row.usuario_id} ${row.sensor_codigo} ${row.estado} ${row.titulo} ${row.mensaje} ${row.tipo}`.toLowerCase();
        const matchesTxt = !txt || blob.includes(txt);
        const matchesTipo = !tipo || (row.tipo || '').toLowerCase() === tipo;
        const matchesEstado = !estado || (row.estado || '').toLowerCase() === estado;
        const matchesSensor = !sensor || (row.sensor_codigo || '').toLowerCase() === sensor;
        return matchesTxt && matchesTipo && matchesEstado && matchesSensor;
      } catch { return true; }
    };
  }

  startPolling(): void {
    // Actualizar estado de usuarios cada 5 segundos
    this.pollingSubscription = interval(5000).subscribe(() => {
      this.updateUserStatus();
    });
  }

  stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }
    if (this.pollingReportsSubscription) {
      this.pollingReportsSubscription.unsubscribe();
      this.pollingReportsSubscription = null;
    }
  }

  updateUserStatus(): void {
    const token = localStorage.getItem('token');
    if (!token) return;

    this.http.get(`${environment.apiBaseUrl}/admin/estado-usuarios`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).subscribe({
      next: (response: any) => {
        // Actualizar solo el estado de conexión de los usuarios
        if (response.usuarios && this.usuariosData && this.usuariosData.actividad_usuarios && Array.isArray(this.usuariosData.actividad_usuarios)) {
          let cambiosDetectados = false;
          this.usuariosData.actividad_usuarios.forEach((usuario: any) => {
            const usuarioActualizado = response.usuarios.find((u: any) => u.id === usuario.id);
            if (usuarioActualizado) {
              const estadoAnterior = usuario.esta_conectado;
              usuario.esta_conectado = usuarioActualizado.esta_conectado;
              usuario.ultima_conexion = usuarioActualizado.ultima_conexion;
              
              if (estadoAnterior !== usuario.esta_conectado) {
                cambiosDetectados = true;
              }
            }
          });
          
          if (cambiosDetectados) {
            // Forzar detección de cambios de Angular
            this.cdr.detectChanges();
          }
        }
      },
      error: () => {}
    });
  }

  // Método para probar manualmente la actualización
  probarActualizacion(): void {
    this.updateUserStatus();
  }

  // Método para sincronizar imágenes de usuario cuando se actualizan
  onUserUpdated(event: any): void {
    if (event.detail && event.detail.imagen_url) {
      // Buscar el usuario en la lista y actualizar su imagen
      const userId = this.getUserIdFromEvent(event);
      if (userId && this.usuariosData?.actividad_usuarios) {
        const user = this.usuariosData.actividad_usuarios.find((u: any) => u.id === userId);
        if (user) {
          user.imagen_url = event.detail.imagen_url;
          // Forzar actualización de la vista
          this.cdr.detectChanges();
        }
      }
    }
  }

  private getUserIdFromEvent(event: any): number | null {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.user_id;
      }
    } catch (e) {
      console.error('Error al obtener user_id del evento:', e);
    }
    return null;
  }

  loadAllData(): void {
    this.isLoading = true;
    
    // Obtener token para autenticación
    const token = localStorage.getItem('token');
    if (!token) {
      this.isLoading = false;
      return;
    }
    
    const headers = { 'Authorization': `Bearer ${token}` };
    
    // Cargar datos del dashboard
    this.http.get<any>(`${environment.apiBaseUrl}/reportes/dashboard`, { headers }).subscribe({
      next: (data) => {
        this.dashboardData = data;
        this.totalSensors = data.total_sensores;
        this.activeSensors = data.sensores_activos;
        this.inactiveSensors = data.sensores_inactivos;
        this.activeAlerts = data.alertas_activas;
        // Cargar datos temporales iniciales
        this.cargarDatosTemporales(headers);
      },
      error: () => {}
    });

    // Cargar configuración del sistema (umbrales/flags/volumen) para tooltip
    this.http.get<any>(`${environment.apiBaseUrl}/configuracion-sistema`, { headers }).subscribe({
      next: (cfg) => {
        this.alertsConfig = cfg || null;
        this.cdr.detectChanges();
      },
      error: () => {}
    });
    
    // Cargar alertas según rango seleccionado
    this.cargarAlertasPorRango(headers);
    // Cargar alertas personalizadas según rango seleccionado
    this.cargarAlertasPersonalizadasPorRango(headers);
    
    // Cargar datos de usuarios
    this.http.get<any>(`${environment.apiBaseUrl}/reportes/usuarios`, { headers }).subscribe({
      next: (data) => {
        // Normalizar estructura de usuarios para asegurar campos usados en el template
        if (data?.actividad_usuarios && Array.isArray(data.actividad_usuarios)) {
          data.actividad_usuarios = data.actividad_usuarios.map((u: any) => ({
            ...u,
            // Asegurar conteo de lecturas y duración
            total_lecturas: typeof u.total_lecturas === 'number' ? u.total_lecturas : (u.total_registros || 0),
            duracion_ultima_sesion: typeof u.duracion_ultima_sesion === 'number' ? u.duracion_ultima_sesion : (u.ultima_sesion_duracion || 0),
            // Unificar timestamp de última conexión/sesión
            ultima_conexion: u.ultima_conexion || u.ultima_sesion || u.ultima_actividad || null,
            // Soporte opcional para inicio/fin de última sesión si vienen separados
            ultima_sesion_inicio: u.ultima_sesion_inicio || u.sesion_inicio || null,
            ultima_sesion_fin: u.ultima_sesion_fin || u.sesion_fin || null,
            // Asegurar que imagen_url esté disponible
            imagen_url: u.imagen_url || null
          }));
        }
        this.usuariosData = data;
        this.totalUsers = data.estadisticas.total_usuarios;
        this.adminUsers = data.estadisticas.admin_usuarios;
        this.regularUsers = data.estadisticas.usuarios_regulares;
        
        // Inicializar filtro y paginación
        this.usuariosFiltrados = this.getFilteredUsers();
        this.inicializarPaginacionUsuarios();
      },
      error: () => {}
    });
    
    // Cargar estado de sensores
    this.http.get<any>(`${environment.apiBaseUrl}/reportes/sensores`, { headers }).subscribe({
      next: (data) => {
        this.sensoresData = data.sensores;
        // Actualizar el array de sensores para compatibilidad
        this.sensors = data.sensores.map((sensor: any) => ({
          id: sensor.id,
          name: sensor.nombre,
          type: sensor.descripcion,
          status: sensor.estado,
          lastValue: sensor.valor_actual,
          unit: sensor.unidad,
          lastUpdate: sensor.ultima_actualizacion ? new Date(sensor.ultima_actualizacion) : new Date()
        }));
        this.sensoresFiltrados = [...this.sensors];
        this.isLoading = false;
        // Cargar series reales para las gráficas (últimas 24h)
        this.cargarSeriesReales(headers);
      },
      error: () => { this.isLoading = false; }
    });

    // Cargar mapa de usuarios (para mostrar nombre en la tabla)
    this.http.get<any>(`${environment.apiBaseUrl}/usuarios`, { headers }).subscribe({
      next: (res) => {
        const list = Array.isArray(res) ? res : (res?.usuarios || []);
        (list || []).forEach((u: any) => {
          const id = Number(u?.id);
          const nombre = String(u?.nombre ?? u?.name ?? u?.usuario ?? u?.email ?? '');
          if (!Number.isNaN(id) && nombre) this.usuariosMap.set(id, nombre);
          const rol = String(u?.rol ?? u?.role ?? '').toLowerCase();
          if (rol === 'usuario' && !Number.isNaN(id) && nombre) {
            this.usuariosSoloUsuario.push({ id, nombre });
          }
        });
      },
      error: () => {}
    });

    // Cargar notificaciones admin
    this.isLoadingNotifs = true;
    this.http.get<AdminNotificacionRow[]>(`${environment.apiBaseUrl}/notificaciones/admin?order=asc&limit=100000`, { headers }).subscribe({
      next: (rows) => {
        // Normalizar fechas a string legible
        const mapped = (rows || []).map(r => ({
          ...r,
          usuario_nombre: this.usuariosMap.get(Number((r as any).usuario_id)) || '',
          creado_en: r?.creado_en ? String(r.creado_en) : '',
          leido_en: r?.leido_en ? String(r.leido_en) : null
        }));
        // Si aún no teníamos el nombre en mapa (por timing), intentar completar al renderizar
        this.notificacionesDataSource.connect().subscribe(data => {
          data.forEach((row: any) => {
            if (!row.usuario_nombre) {
              const name = this.usuariosMap.get(Number(row.usuario_id));
              if (name) row.usuario_nombre = name;
            }
          });
        });
        // Orden por ID ascendente
        mapped.sort((a, b) => Number(a.id) - Number(b.id));
        this.notificacionesDataSource.data = mapped;
        setTimeout(() => {
          if (this.notifPaginator) this.notificacionesDataSource.paginator = this.notifPaginator;
          this.cdr.detectChanges();
        });
        this.aplicarFiltroNotificaciones();
        this.isLoadingNotifs = false;
      },
      error: () => { this.isLoadingNotifs = false; }
    });

    this.setupPollingWithoutCharts();
  }

  private setupPollingWithoutCharts(): void {
    if (this.pollingReportsSubscription) {
      this.pollingReportsSubscription.unsubscribe();
    }
    
    this.pollingReportsSubscription = interval(5000).subscribe(() => {
      const token = localStorage.getItem('token');
      if (!token) return;
      
      const headers = { 'Authorization': `Bearer ${token}` };
      
      // Solo actualizar métricas del dashboard
      this.http.get<any>(`${environment.apiBaseUrl}/reportes/dashboard`, { headers }).subscribe({
        next: (data) => {
          this.totalSensors = data.total_sensores;
          this.activeSensors = data.sensores_activos;
          this.inactiveSensors = data.sensores_inactivos;
          this.activeAlerts = data.alertas_activas;
          // NO forzar detectChanges
        },
        error: () => {}
      });
      
      // Actualizar alertas SIN recalcular series y SIN mostrar loading
      this.cargarAlertasSinRecalcular(headers);
      this.cargarAlertasPersonalizadasSinLoading(headers);
    });
  }

  private cargarAlertasSinRecalcular(headers: any): void {
    const base = `${environment.apiBaseUrl}/reportes/alertas`;
    let url = base;
    
    if (this.customDateRange && this.customDateFrom && this.customDateTo) {
      const diffTime = Math.abs(this.customDateTo.getTime() - this.customDateFrom.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      url = `${base}?rango=dias&dias=${diffDays}`;
    } else {
      let rango = 'today';
      if (this.selectedDateRange === 'week') rango = 'week';
      else if (this.selectedDateRange === 'month') rango = 'month';
      url = `${base}?rango=${rango}`;
    }
    
    this.http.get<any>(url, { headers }).subscribe({
      next: (data) => {
        this.alertasData = data?.alertas || [];
        this.aplicarFiltrosAlertas();
        // NO recalcular series aquí
        // NO forzar detectChanges - esto causa que los gráficos se vacíen
      },
      error: () => {}
    });
  }

  updateSimulatedData(): void {
    // Simular cambios en los datos
    this.sensors.forEach(sensor => {
      if (sensor.status === 'active') {
        // Simular variaciones pequeñas en los valores
        const variation = (Math.random() - 0.5) * 2;
        sensor.lastValue = Math.max(0, sensor.lastValue + variation);
        // Limitar a 2 decimales
        sensor.lastValue = Math.round(sensor.lastValue * 100) / 100;
        sensor.lastUpdate = new Date();
      }
    });
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'active': return 'primary';
      case 'inactive': return 'accent';
      default: return 'primary';
    }
  }

  getSeverityColor(severity: string): string {
    if (!severity) return 'primary';
    const s = String(severity).toLowerCase();
    // Colores del tema: 'warn' rojo, 'accent' teal, 'primary' azul/teal
    if (s === 'malo') return 'warn';
    if (s === 'advertencia') return 'accent';
    return 'primary'; // bueno
  }

  getSeverityHex(severity: string): string {
    const s = (severity || '').toLowerCase();
    if (s === 'malo') return '#d32f2f';       // rojo
    if (s === 'advertencia') return '#f59e0b'; // ámbar
    return '#2e7d32';                          // verde para bueno
  }

  getSeverityClass(severity: string): string {
    const s = (severity || '').toLowerCase();
    if (s === 'malo') return 'sev-malo';
    if (s === 'advertencia') return 'sev-advertencia';
    return 'sev-bueno';
  }

  getSensorIcon(sensorName: string): string {
    switch (sensorName) {
      case 'MQ-135': return 'air';
      case 'MQ-7': return 'warning';
      case 'MQ-4': return 'gas_meter';
      default: return 'sensors';
    }
  }

  exportReport(format: string): void {}

  refreshData(): void { this.loadAllData();   }

  private cargarDatosTemporales(headers: any): void {
    const scopes = ['today', 'week', 'month'];
    
    scopes.forEach(scope => {
      this.http.get<any>(`${environment.apiBaseUrl}/reportes/analitica?scope=${scope}`, { headers }).subscribe({
        next: (data) => {
          console.log(`[DEBUG Frontend] Analítica ${scope}:`, data);
          
          let total = 0;
          
          // Intentar múltiples formas de obtener el total
          if (data?.total !== undefined && data.total !== null) {
            total = Number(data.total);
          } else if (data?.totales?.total !== undefined && data.totales.total !== null) {
            total = Number(data.totales.total);
          } else if (data?.totales) {
            // Sumar individuales como fallback
            total = (Number(data.totales.mq135) || 0) + 
                    (Number(data.totales.mq7) || 0) + 
                    (Number(data.totales.mq4) || 0);
          }
          
          // Validar
          if (!Number.isFinite(total)) {
            total = 0;
          }
          
          console.log(`[DEBUG Frontend] ${scope} - Total calculado:`, total);
          
          // Actualizar
          if (scope === 'today') this.temporalData.hoy = total;
          else if (scope === 'week') this.temporalData.semana = total;
          else if (scope === 'month') this.temporalData.mes = total;
          
          // IMPORTANTE: Forzar detección de cambios
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error(`[DEBUG Frontend] Error ${scope}:`, err);
          if (scope === 'today') this.temporalData.hoy = 0;
          else if (scope === 'week') this.temporalData.semana = 0;
          else if (scope === 'month') this.temporalData.mes = 0;
        }
      });
    });
  }

  private cargarAlertasPersonalizadasSinLoading(headers: any): void {
    const base = `${environment.apiBaseUrl}/reportes/alertas-personalizadas`;
    
    let url = base;
    if (this.customDateRange && this.customDateFrom && this.customDateTo) {
      const diffTime = Math.abs(this.customDateTo.getTime() - this.customDateFrom.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      url = `${base}?rango=dias&dias=${diffDays}`;
    } else {
      let rango = 'today';
      if (this.selectedDateRange === 'week') rango = 'week';
      else if (this.selectedDateRange === 'month') rango = 'month';
      url = `${base}?rango=${rango}`;
    }
    
    this.http.get<any>(url, { headers }).subscribe({
      next: (data) => {
        this.alertasPersonalizadasData = data?.alertas || [];
        this.alertasPersonalizadasFiltradas = [...this.alertasPersonalizadasData];
        this.alertasPersonalizadasPaginadas = this.alertasPersonalizadasFiltradas.slice(0, this.alertPageSize);
      },
      error: () => {}
    });
  }

  private cargarAlertasPersonalizadasPorRango(headers: any): void {
    this.isLoadingAlerts = true;
    const base = `${environment.apiBaseUrl}/reportes/alertas-personalizadas`;
    
    let url = base;
    if (this.customDateRange && this.customDateFrom && this.customDateTo) {
      const diffTime = Math.abs(this.customDateTo.getTime() - this.customDateFrom.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      url = `${base}?rango=dias&dias=${diffDays}`;
    } else {
      let rango = 'today';
      if (this.selectedDateRange === 'week') rango = 'week';
      else if (this.selectedDateRange === 'month') rango = 'month';
      url = `${base}?rango=${rango}`;
    }
    
    this.http.get<any>(url, { headers }).subscribe({
      next: (data) => {
        this.alertasPersonalizadasData = data?.alertas || [];
        this.alertasPersonalizadasFiltradas = [...this.alertasPersonalizadasData];
        this.alertasPersonalizadasPaginadas = this.alertasPersonalizadasFiltradas.slice(0, this.alertPageSize);
        this.isLoadingAlerts = false;
      },
      error: () => { this.isLoadingAlerts = false; }
    });
  }

  onChangeSensor(): void {
    // Filtrar tarjetas de estado
    if (!this.selectedSensor) {
      this.sensoresFiltrados = [...this.sensors];
    } else {
      this.sensoresFiltrados = this.sensors.filter(s => s.name === this.selectedSensor);
    }

    // Filtrar alertas por sensor
    this.aplicarFiltrosAlertas();

    // Ajustar carrusel
    if (this.selectedSensor) {
      const map: any = { 'MQ-135': 'mq135', 'MQ-7': 'mq7', 'MQ-4': 'mq4' };
      const key = map[this.selectedSensor];
      if (key) {
        const idx = this.chartDefs.findIndex(d => d.key === key);
        if (idx >= 0) {
          this.chartIndex = idx;
        }
      }
    } else {
      this.chartIndex = 0;
    }
    
    // Forzar actualización de vista
    this.cdr.detectChanges();
  }

  // Mejorar shouldShowChart
  shouldShowChart(key: string): boolean {
    // Si no hay sensor seleccionado, mostrar todos
    if (!this.selectedSensor) {
      return true;
    }
    
    // Si hay sensor seleccionado, solo mostrar el correspondiente
    const map: any = { 'MQ-135': 'mq135', 'MQ-7': 'mq7', 'MQ-4': 'mq4' };
    const selectedKey = map[this.selectedSensor];
    
    return key === selectedKey;
  }

  onChangeDateRange(): void {
    if (this.selectedDateRange === 'custom') {
      this.customDateRange = true;
      return;
    }
    
    this.customDateRange = false;
    this.customDateFrom = undefined;
    this.customDateTo = undefined;
    
    const hoy = new Date();
    const inicio = new Date(hoy);
    
    switch (this.selectedDateRange) {
      case 'today':
        inicio.setHours(0,0,0,0);
        this.filtroDesde = inicio;
        this.filtroHasta = hoy;
        break;
      case 'week':
        inicio.setDate(hoy.getDate() - 7);
        inicio.setHours(0,0,0,0);
        this.filtroDesde = inicio;
        this.filtroHasta = hoy;
        break;
      case 'month':
        inicio.setDate(hoy.getDate() - 30);
        inicio.setHours(0,0,0,0);
        this.filtroDesde = inicio;
        this.filtroHasta = hoy;
        break;
      default:
        this.filtroDesde = undefined;
        this.filtroHasta = undefined;
    }
    
    const token = localStorage.getItem('token');
    if (token) {
      const headers = { 'Authorization': `Bearer ${token}` };
      
      // Calcular límite apropiado según el rango
      let limit = 1000;
      if (this.selectedDateRange === 'week') limit = 3000;
      else if (this.selectedDateRange === 'month') limit = 10000;
      
      
      // Cargar lecturas con límite apropiado
      this.isLoading = true;
      this.http.get<any>(`${environment.apiBaseUrl}/lecturas/admin?limit=${limit}`, { headers }).subscribe({
        next: (data) => {
          this.rawLecturas = {
            mq135: data.mq135 || [],
            mq7: data.mq7 || [],
            mq4: data.mq4 || []
          };
          
          // Recalcular series con los nuevos datos
          this.recalcularSeriesPorRango();
          
          this.isLoading = false;
        },
        error: () => {
          this.isLoading = false;
        }
      });
      
      // Recargar alertas con el nuevo rango
      this.cargarAlertasPorRango(headers);
      this.cargarAlertasPersonalizadasPorRango(headers);
      
      // Actualizar analítica temporal
      const scope = this.selectedDateRange === 'week' ? 'week' : (this.selectedDateRange === 'month' ? 'month' : 'today');
      this.http.get<any>(`${environment.apiBaseUrl}/reportes/analitica?scope=${scope}`, { headers }).subscribe({
        next: (d) => {
          this.dashboardData = { ...(this.dashboardData || {}), temporalTotals: d?.totales, temporalLabel: d?.label };
        },
        error: () => {}
      });
    }
  }
  
  private recargarDatosPorRango(): void {
    const token = localStorage.getItem('token');
    if (token) {
      const headers = { 'Authorization': `Bearer ${token}` };
      this.cargarAlertasPorRango(headers);
      this.cargarAlertasPersonalizadasPorRango(headers);
      
      // Recargar estado de sensores
      this.http.get<any>(`${environment.apiBaseUrl}/reportes/sensores`, { headers }).subscribe({
        next: (data) => {
          this.sensoresData = data.sensores;
          // Actualizar el array de sensores para compatibilidad
          this.sensors = data.sensores.map((sensor: any) => ({
            id: sensor.id,
            name: sensor.nombre,
            type: sensor.descripcion,
            status: sensor.estado,
            lastValue: sensor.valor_actual,
            unit: sensor.unidad,
            lastUpdate: sensor.ultima_actualizacion ? new Date(sensor.ultima_actualizacion) : new Date()
          }));
          this.sensoresFiltrados = [...this.sensors];
        },
        error: () => {}
      });
      
      // Actualizar analítica temporal
      let scope = 'today';
      if (this.customDateRange) {
        // Para rangos personalizados, usar 'today' como fallback
        scope = 'today';
      } else {
        scope = this.selectedDateRange === 'week' ? 'week' : (this.selectedDateRange === 'month' ? 'month' : 'today');
      }
      
      this.http.get<any>(`${environment.apiBaseUrl}/reportes/analitica?scope=${scope}`, { headers }).subscribe({ 
        next: (d)=> { 
          this.dashboardData = { ...(this.dashboardData||{}), temporalTotals: d?.totales, temporalLabel: d?.label }; 
        }, 
        error: ()=>{} 
      });
      
      // Calcular días entre fechas para determinar el límite
      if (this.customDateRange && this.customDateFrom && this.customDateTo) {
        const diffTime = Math.abs(this.customDateTo.getTime() - this.customDateFrom.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        let limit = 1000;
        if (diffDays <= 7) limit = 2000;
        else if (diffDays <= 30) limit = 5000;
        else limit = 10000;
        
        this.http.get<any>(`${environment.apiBaseUrl}/lecturas/admin?limit=${limit}`, { headers }).subscribe({
          next: (data) => {
            // Actualizar lecturas crudas con más datos para el nuevo rango
            this.rawLecturas = {
              mq135: data.mq135 || [],
              mq7: data.mq7 || [],
              mq4: data.mq4 || []
            };
            // Recalcular series con el nuevo rango y los nuevos datos
            this.recalcularSeriesPorRango();
          },
          error: () => {
            // Si falla, intentar recalcular con los datos existentes
            this.recalcularSeriesPorRango();
          }
        });
      } else {
        // Si no es rango personalizado, recalcular con datos existentes
        this.recalcularSeriesPorRango();
      }
    } else {
      // Si no hay token, solo recalcular con datos existentes
      this.recalcularSeriesPorRango();
    }

    // Aplicar a alertas
    this.aplicarFiltrosAlertas();
    
    // NO forzar detectChanges - Angular detectará los cambios automáticamente
    // Forzar detectChanges causa que los gráficos desaparezcan
  }
  
  onChangeCustomDateRange(): void {
    // Solo procesar si ambas fechas están seleccionadas
    if (!this.customDateFrom || !this.customDateTo) {
      return;
    }
    
    // Validar que la fecha "desde" sea anterior a "hasta"
    if (this.customDateFrom > this.customDateTo) {
      // Intercambiar fechas si están al revés
      const temp = this.customDateFrom;
      this.customDateFrom = this.customDateTo;
      this.customDateTo = temp;
    }
    
    // Activar rango personalizado
    this.customDateRange = true;
    
    // Establecer fechas con horas correctas (inicio del día para desde, fin del día para hasta)
    const desde = new Date(this.customDateFrom);
    desde.setHours(0, 0, 0, 0);
    this.filtroDesde = desde;
    
    const hasta = new Date(this.customDateTo);
    hasta.setHours(23, 59, 59, 999);
    this.filtroHasta = hasta;
    
    // Recargar datos con el rango personalizado
    this.recargarDatosPorRango();
  }

  private cargarAlertasPorRango(headers: any): void {
    this.isLoadingAlerts = true;
    // Usar base del environment para coincidir con el backend actual
    const base = `${environment.apiBaseUrl}/reportes/alertas`;
    
    let url = base;
    if (this.customDateRange && this.customDateFrom && this.customDateTo) {
      // Calcular días entre fechas
      const diffTime = Math.abs(this.customDateTo.getTime() - this.customDateFrom.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      url = `${base}?rango=dias&dias=${diffDays}`;
    } else {
      let rango = 'today';
      if (this.selectedDateRange === 'week') rango = 'week';
      else if (this.selectedDateRange === 'month') rango = 'month';
      url = `${base}?rango=${rango}`;
    }
    
    this.http.get<any>(url, { headers }).subscribe({
      next: (data) => {
        this.alertasData = data?.alertas || [];
        this.aplicarFiltrosAlertas();
        this.isLoadingAlerts = false;
        // NO recalcular series aquí - ya se hace en onChangeDateRange o recargarDatosPorRango
        // NO forzar detectChanges aquí para evitar que los gráficos desaparezcan durante el polling
        // Solo actualizar los datos, Angular detectará los cambios automáticamente
      },
      error: () => { this.isLoadingAlerts = false; }
    });
  }

  onChangeSeverity(): void {
    this.aplicarFiltrosAlertas();
  }

  private aplicarFiltrosAlertas(): void {
    const sensorMap: any = {
      'MQ-135': 'mq135',
      'MQ-7': 'mq7',
      'MQ-4': 'mq4'
    };
    const normalizeSeverity = (s: string) => {
      if (!s) return '';
      const lower = s.toLowerCase();
      if (lower === 'mala') return 'malo';
      if (lower === 'todas' || lower === 'todes' || lower === 'all') return '';
      return lower;
    };
    const selectedSeverity = normalizeSeverity(this.selectedAlertSeverity);
    
    this.alertasFiltradas = (this.alertasData || []).filter(a => {
      let ok = true;
      // Sensor
      if (this.selectedSensor) {
        const sel = this.selectedSensor;
        ok = ok && (
          (sel === 'MQ-135' && a.sensor === 'MQ-135') ||
          (sel === 'MQ-7' && a.sensor === 'MQ-7') ||
          (sel === 'MQ-4' && a.sensor === 'MQ-4')
        );
      }
      // Severidad
      if (selectedSeverity) {
        ok = ok && (String(a.severidad).toLowerCase() === selectedSeverity);
      }
      // NOTA: No filtrar por fecha aquí - el backend ya filtra correctamente por rango
      // El filtro adicional en el cliente causaba problemas eliminando alertas válidas
      return ok;
    });
    

    // Reiniciar y aplicar paginación
    this.alertCurrentPage = 0;
    this.actualizarPaginacionAlertas();
  }

  private actualizarPaginacionAlertas(): void {
    const total = this.alertasFiltradas.length || 0;
    this.alertTotalPages = Math.max(1, Math.ceil(total / this.alertPageSize));
    const start = this.alertCurrentPage * this.alertPageSize;
    const end = start + this.alertPageSize;
    this.alertasPaginadas = this.alertasFiltradas.slice(start, end);
  }

  // ------- CRUD Notificaciones (admin) -------
  aplicarFiltroNotificaciones(): void {
    const payload = {
      txt: (this.notifFiltroTexto || '').trim(),
      tipo: this.filtroTipo || '',
      estado: this.filtroEstado || '',
      sensor: this.filtroSensor || ''
    };
    // Cambiar referencia para disparar filtrado
    this.notificacionesDataSource.filter = JSON.stringify(payload);
    if (this.notifPaginator) this.notifPaginator.firstPage();
  }

  crearNotificacion(row?: Partial<AdminNotificacionRow>): void {
    const dialogRef = this.dialog.open(NotifCreateDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: { 
        ...row, 
        usuarios: this.usuariosSoloUsuario 
      }
    });
    
    dialogRef.afterClosed().subscribe((result: AdminNotificacionRow | null) => {
      if (!result) return;
      
      const body: any = {
        usuario_id: result.usuario_id,
        titulo: result.titulo,
        mensaje: result.mensaje,
        tipo: result.tipo || 'info',
        leida: result.leida || false
      };
      
      // Solo incluir campos de sensor si se seleccionó uno específico
      if (result.sensor_codigo && result.sensor_codigo !== '') {
        body.sensor_codigo = result.sensor_codigo;
        body.valor = result.valor || 0;
        body.estado = result.estado || 'bueno';
      } else {
        // Si no se seleccionó sensor, usar un valor especial para notificaciones generales
        body.sensor_codigo = 'general';
        body.valor = 0;
        body.estado = 'bueno';
      }
      
      const token = localStorage.getItem('token');
      if (!token) return;
      const headers = { 'Authorization': `Bearer ${token}` };
      
      this.http.post<AdminNotificacionRow>(`${environment.apiBaseUrl}/notificaciones`, body, { headers }).subscribe({
        next: (created) => {
          const data = [created, ...this.notificacionesDataSource.data];
          data.sort((a, b) => Number(a.id) - Number(b.id));
          this.notificacionesDataSource.data = data;
          this.aplicarFiltroNotificaciones();
          this.notificationService.showUserSuccess('Notificación enviada correctamente');
        },
        error: (err) => {
          console.error('Error creando notificación:', err);
          this.notificationService.showUserError('crear notificación', 'No se pudo enviar la notificación');
        }
      });
    });
  }

  actualizarNotificacion(row: AdminNotificacionRow): void {
    const token = localStorage.getItem('token');
    if (!token) return;
    const headers = { 'Authorization': `Bearer ${token}` };
    const cambios: any = {
      usuario_id: row.usuario_id,
      sensor_codigo: row.sensor_codigo,
      valor: row.valor,
      estado: row.estado,
      titulo: row.titulo,
      mensaje: row.mensaje,
      tipo: row.tipo,
      leida: row.leida
    };
    this.http.put<AdminNotificacionRow>(`${environment.apiBaseUrl}/notificaciones/${row.id}`, cambios, { headers }).subscribe({
      next: (updated) => {
        const data = this.notificacionesDataSource.data.map(r => r.id === updated.id ? updated : r);
        data.sort((a, b) => Number(a.id) - Number(b.id));
        this.notificacionesDataSource.data = data;
        this.aplicarFiltroNotificaciones();
      }
    });
  }

  

  eliminarNotificacion(row: AdminNotificacionRow): void {
    const dialogRef = this.dialog.open(ConfirmDeleteDialogComponent, {
      width: '500px',
      maxWidth: '90vw',
      data: {
        title: 'Confirmar Eliminación',
        message: '¿Estás seguro de que quieres eliminar esta notificación del sistema?',
        itemName: `Notificación #${row.id} • ${row.titulo || row.tipo}`
      }
    });
    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (!confirmed) return;
      const token = localStorage.getItem('token');
      if (!token) return;
      const headers = { 'Authorization': `Bearer ${token}` };
      this.http.delete(`${environment.apiBaseUrl}/notificaciones/${row.id}`, { headers }).subscribe({
        next: () => {
          this.notificacionesDataSource.data = this.notificacionesDataSource.data.filter(r => r.id !== row.id);
          this.aplicarFiltroNotificaciones();
          this.notificationService.showUserSuccess('Notificación eliminada correctamente');
        },
        error: (err) => {
          console.error('Error eliminando notificación:', err);
          this.notificationService.showUserError('eliminar notificación', 'No se pudo eliminar la notificación');
        }
      });
    });
  }

  // ---- Diálogo de edición ----
  abrirDialogoEditar(row: AdminNotificacionRow): void {
    const dialogRef = this.dialog.open(NotifEditDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      data: { ...row, usuarios: this.usuariosSoloUsuario }
    });
    dialogRef.afterClosed().subscribe((result: AdminNotificacionRow | null) => {
      if (!result) return;
      this.actualizarNotificacion(result);
    });
  }

  paginaAnteriorAlertas(): void {
    if (this.alertCurrentPage > 0) {
      this.alertCurrentPage--;
      this.actualizarPaginacionAlertas();
    }
  }

  siguientePaginaAlertas(): void {
    if (this.alertCurrentPage < this.alertTotalPages - 1) {
      this.alertCurrentPage++;
      this.actualizarPaginacionAlertas();
    }
  }

  irAPaginaAlertas(i: number): void {
    if (i >= 0 && i < this.alertTotalPages) {
      this.alertCurrentPage = i;
      this.actualizarPaginacionAlertas();
    }
  }

  onPageAlertas(event: PageEvent): void {
    this.alertPageSize = event.pageSize;
    this.alertCurrentPage = event.pageIndex;
    this.actualizarPaginacionAlertas();
  }

  // Métodos para generar los gráficos SVG
  getXPosition(index: number): number {
    const spacing = 400 / 5; // 6 puntos, 5 espacios
    return 20 + (index * spacing);
  }

  getYPosition(value: number, data: any[]): number {
    const values = (data || []).map(d => Number(d?.value)).filter(v => Number.isFinite(v));
    if (values.length === 0 || !Number.isFinite(Number(value))) {
      return 180 - (0.5 * 160) + 10;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const normalizedValue = (Number(value) - min) / range;
    return 180 - (normalizedValue * 160) + 10; // Invertir Y y agregar margen
  }

  getPM25ChartPoints(): string {
    return this.pm25Data.map((point, index) => {
      const x = this.getXPosition(index);
      const y = this.getYPosition(point.value, this.pm25Data);
      return `${x},${y}`;
    }).join(' ');
  }

  getAirQualityChartPoints(): string {
    return this.airQualityData.map((point, index) => {
      const x = this.getXPosition(index);
      const y = this.getYPosition(point.value, this.airQualityData);
      return `${x},${y}`;
    }).join(' ');
  }

  // Helpers para carrusel
  getDataByKey(key: string): any[] {
    switch (key) {
      case 'mq135': return this.pm25Data || [];
      case 'mq7': return this.airQualityData || [];
      case 'mq4': return this.methaneData || [];
      default: return this.pm25Data || [];
    }
  }

  getChartPointsByKey(key: string): string {
    const data = this.getSafeDataByKey(key);
    if (!data || data.length === 0) return '';
    try {
      return data.map((point, index) => {
        const x = this.getXPosition(index);
        const y = this.getYPosition(point.value, data);
        return `${x},${y}`;
      }).join(' ');
    } catch (e) {
      console.error('Error generando puntos del gráfico:', e);
      return '';
    }
  }

  isFiniteNumber(value: any): boolean {
    return Number.isFinite(Number(value));
  }

  getSafeDataByKey(key: string): any[] {
    const data = this.getDataByKey(key);
    if (!data || !Array.isArray(data)) return [];
    return data.filter(p => p && this.isFiniteNumber(p?.value));
  }

  /**
   * Obtiene estadísticas agregadas de los datos para mostrar debajo del gráfico
   * Muestra máximo 5 datos: promedio, mínimo, máximo, primer valor, último valor
   */
  getLimitedDataByKey(key: string, maxPoints: number = 5): any[] {
    const data = this.getSafeDataByKey(key);
    if (!data || data.length === 0) return [];
    
    const values = data.map(p => Number(p.value)).filter(v => Number.isFinite(v));
    if (values.length === 0) return [];
    
    const stats: any[] = [];
    
    // 1. Promedio
    const promedio = values.reduce((acc, v) => acc + v, 0) / values.length;
    stats.push({
      time: 'Promedio',
      value: Number(promedio.toFixed(2))
    });
    
    // 2. Mínimo
    const minimo = Math.min(...values);
    const minIndex = values.indexOf(minimo);
    stats.push({
      time: data[minIndex]?.time || 'Mínimo',
      value: Number(minimo.toFixed(2))
    });
    
    // 3. Máximo
    const maximo = Math.max(...values);
    const maxIndex = values.indexOf(maximo);
    stats.push({
      time: data[maxIndex]?.time || 'Máximo',
      value: Number(maximo.toFixed(2))
    });
    
    // 4. Primer valor
    if (data.length > 0) {
      stats.push({
        time: data[0].time || 'Inicio',
        value: Number(values[0].toFixed(2))
      });
    }
    
    // 5. Último valor
    if (data.length > 1) {
      stats.push({
        time: data[data.length - 1].time || 'Final',
        value: Number(values[values.length - 1].toFixed(2))
      });
    }
    
    return stats.slice(0, maxPoints);
  }

  getVisibleCharts(): any[] {
    // Si hay sensor seleccionado, mostrar solo su gráfica como primera
    if (this.selectedSensor) {
      const map: any = { 'MQ-135': 'mq135', 'MQ-7': 'mq7', 'MQ-4': 'mq4' };
      const key = map[this.selectedSensor];
      if (key) {
        const chosen = this.chartDefs.find(d => d.key === key);
        return chosen ? [chosen] : this.chartDefs.slice(0, 2); // Fallback si no encuentra
      }
    }
    // Sin filtro: mostrar dos consecutivas
    const first = this.chartDefs[this.chartIndex % this.chartDefs.length];
    const second = this.chartDefs[(this.chartIndex + 1) % this.chartDefs.length];
    return [first, second].filter(c => c); // Filtrar undefined
  }

  nextCharts(): void {
    this.animationClass = 'slide-next';
    setTimeout(() => {
      this.chartIndex = (this.chartIndex + 1) % this.chartDefs.length;
      this.animationClass = 'enter-next';
      setTimeout(() => {
        this.animationClass = '';
      }, 250);
    }, 200);
  }

  prevCharts(): void {
    this.animationClass = 'slide-prev';
    setTimeout(() => {
      this.chartIndex = (this.chartIndex - 1 + this.chartDefs.length) % this.chartDefs.length;
      this.animationClass = 'enter-prev';
      setTimeout(() => {
        this.animationClass = '';
      }, 250);
    }, 200);
  }

  // Cargar series reales desde backend admin y agrupar por hora (últimas 24h)
  private cargarSeriesReales(headers: any): void {
    // Cargar más datos inicialmente para tener suficiente información para todos los rangos
    this.http.get<any>(`${environment.apiBaseUrl}/lecturas/admin?limit=5000`, { headers }).subscribe({
      next: (data) => {
        // Guardar lecturas crudas para recalcular por rango
        this.rawLecturas = {
          mq135: data.mq135 || [],
          mq7: data.mq7 || [],
          mq4: data.mq4 || []
        };
        // Recalcular según rango actual
        this.recalcularSeriesPorRango();
      },
      error: () => {}
    });
  }

  private getTituloRango(): string {
    if (this.customDateRange && this.customDateFrom && this.customDateTo) {
      const fromStr = this.customDateFrom.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      const toStr = this.customDateTo.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      return `${fromStr} - ${toStr}`;
    }
    if (this.selectedDateRange === 'week') return 'Esta semana';
    if (this.selectedDateRange === 'month') return 'Este mes';
    return 'Últimas 24h';
  }

  private recalcularSeriesPorRango(): void {
    const ahora = new Date();
    let desde: Date;
    let hasta: Date;
    let step = 4; // horas por defecto
    
    // Encontrar la fecha más reciente en los datos para asegurar que el rango la incluya
    let fechaMasReciente = ahora;
    let maxTime = ahora.getTime();
    
    // Revisar solo los primeros 100 items de cada sensor (los más recientes)
    const arrays = [
      (this.rawLecturas.mq135 || []).slice(0, 100),
      (this.rawLecturas.mq7 || []).slice(0, 100),
      (this.rawLecturas.mq4 || []).slice(0, 100)
    ];
    
    for (const arr of arrays) {
      for (const item of arr) {
        if (item?.fecha_lectura) {
          const fecha = new Date(item.fecha_lectura);
          if (!isNaN(fecha.getTime())) {
            const time = fecha.getTime();
            if (time > maxTime) {
              maxTime = time;
              fechaMasReciente = fecha;
            }
          }
        }
      }
    }
    
    if (this.customDateRange && this.customDateFrom && this.customDateTo) {
      desde = new Date(this.customDateFrom);
      desde.setHours(0, 0, 0, 0);
      hasta = new Date(this.customDateTo);
      hasta.setHours(23, 59, 59, 999);
      
      // Asegurar que hasta incluya la fecha más reciente de los datos
      if (fechaMasReciente > hasta) {
        hasta = new Date(fechaMasReciente);
        hasta.setSeconds(59, 999);
      }
      
      const diffTime = Math.abs(hasta.getTime() - desde.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays <= 1) step = 4;
      else if (diffDays <= 7) step = 3;
      else if (diffDays <= 30) step = 24;
      else step = 24 * 7;
    } else {
      // Usar la fecha más reciente de los datos o ahora, lo que sea mayor
      hasta = fechaMasReciente > ahora ? fechaMasReciente : ahora;
      
      if (this.selectedDateRange === 'week') {
        desde = new Date(hasta);
        desde.setDate(desde.getDate() - 7);
        desde.setHours(0, 0, 0, 0);
        step = 6; // 4 puntos por día aprox
      } else if (this.selectedDateRange === 'month') {
        desde = new Date(hasta);
        desde.setDate(desde.getDate() - 30);
        desde.setHours(0, 0, 0, 0);
        step = 24; // 1 punto por día
      } else {
        desde = new Date(hasta);
        desde.setDate(desde.getDate() - 1);
        desde.setHours(0, 0, 0, 0);
        step = 4; // 6 puntos en 24h
      }
    }
    
    this.construirSeriesConRango(desde, hasta, step);
  }
  
  private construirSeriesConRango(desde: Date, hasta: Date, stepHours: number): void {
    const construirSerie = (items: any[], step: number, nombreSensor: string) => {
      if (!items || items.length === 0) {
        return [];
      }
      
      const filtrados = items.filter((i: any) => {
        if (!i.fecha_lectura) return false;
        const fechaLectura = new Date(i.fecha_lectura);
        if (isNaN(fechaLectura.getTime())) {
          return false;
        }
        return fechaLectura >= desde && fechaLectura <= hasta;
      });
      
      if (filtrados.length === 0) {
        return [];
      }
      
      const serie: { time: string, value: number }[] = [];
      
      // Pre-calcular timestamps para evitar conversiones repetidas
      const desdeTime = desde.getTime();
      const hastaTime = hasta.getTime();
      const stepMs = step * 60 * 60 * 1000;
      
      // Pre-procesar fechas de los filtrados para evitar conversiones repetidas
      const datosConTimestamp = filtrados
        .map((r: any) => {
          if (!r.fecha_lectura) return null;
          const t = new Date(r.fecha_lectura);
          if (isNaN(t.getTime())) return null;
          return { timestamp: t.getTime(), valor: Number(r.valor) };
        })
        .filter((d: any) => d !== null && Number.isFinite(d.valor));
      
      let t0Time = desdeTime;
      let ventanaCount = 0;
      const maxVentanas = 1000; // Límite de seguridad para evitar loops infinitos
      
      while (t0Time <= hastaTime && ventanaCount < maxVentanas) {
        const t1Time = Math.min(hastaTime, t0Time + stepMs);
        const isLastPoint = t1Time >= hastaTime;
        
        // Filtrar datos en esta ventana
        const enVentana = datosConTimestamp.filter((d: any) => {
          return d.timestamp >= t0Time && (isLastPoint ? d.timestamp <= t1Time : d.timestamp < t1Time);
        });
        
        if (enVentana.length > 0) {
          const avg = enVentana.reduce((acc: number, d: any) => acc + d.valor, 0) / enVentana.length;
          if (Number.isFinite(avg) && Math.abs(avg) >= 1e-6) {
            const t0 = new Date(t0Time);
            let label: string;
            if (this.customDateRange || step >= 24) {
              label = `${('0' + (t0.getMonth() + 1)).slice(-2)}/${('0' + t0.getDate()).slice(-2)}`;
            } else {
              label = `${('0' + t0.getHours()).slice(-2)}:00`;
            }
            
            serie.push({ time: label, value: Number(avg.toFixed(2)) });
          }
        }
        
        // Avanzar a la siguiente ventana
        t0Time = t1Time;
        ventanaCount++;
      }
      
      return serie;
    };

    // Construir series
    const newPm25Data = construirSerie(this.rawLecturas.mq135 || [], stepHours, 'MQ-135');
    const newAirQualityData = construirSerie(this.rawLecturas.mq7 || [], stepHours, 'MQ-7');
    const newMethaneData = construirSerie(this.rawLecturas.mq4 || [], stepHours, 'MQ-4');

    this.pm25Data.length = 0;
    this.pm25Data.push(...newPm25Data);
    
    this.airQualityData.length = 0;
    this.airQualityData.push(...newAirQualityData);
    
    this.methaneData.length = 0;
    this.methaneData.push(...newMethaneData);

    // Guardar copias
    this.pm25DataOriginal = [...this.pm25Data];
    this.airQualityDataOriginal = [...this.airQualityData];
    this.methaneDataOriginal = [...this.methaneData];

    // Actualizar títulos
    const rangoTxt = this.getTituloRango();
    this.chartDefs = this.chartDefs.map(d => ({
      ...d,
      title: `${d.key === 'mq135' ? 'MQ-135 - Calidad del Aire' : d.key === 'mq7' ? 'MQ-7 - Monóxido de Carbono' : 'MQ-4 - Gas Metano'} - ${rangoTxt}`,
      subtitle: `${d.key === 'mq135' ? 'Calidad del Aire' : d.key === 'mq7' ? 'Monóxido de Carbono' : 'Gas Metano'} - ${rangoTxt}`
    }));
  }

  // ---------- Helper para fechas ----------
  private formatDate(date: any): string {
    if (!date) return '—';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '—';
    }
  }

  // ---------- Exportación ----------
  abrirDialogoExportar(): void {
    const dialogRef = this.dialog.open(ExportDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      data: {
        type: 'pdf',
        sections: {
          dashboard: true,
          sensores: true,
          alertas: true,
          alertasSistema: true,
          alertasPersonalizadas: true,
          notificaciones: true,
          usuarios: true,
          analisisTemporal: true
        }
      }
    });
    dialogRef.afterClosed().subscribe(result => {
      if (!result) return;
      const { type, sections } = result;
      if (type === 'pdf') this.exportarPDF(sections);
      else if (type === 'csv') this.exportarCSV(sections);
      else if (type === 'excel') this.exportarExcel(sections);
    });
  }

  private exportarPDF(sections: any): void {
    // Lazy import para jsPDF y autotable (función)
    // @ts-ignore
    import('jspdf').then(({ default: jsPDF }) => {
      // @ts-ignore
      import('jspdf-autotable').then(async (mod: any) => {
        const autoTable = (mod && mod.default) ? mod.default : (mod?.autoTable || (window as any)['autoTable']);
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        let y = 32;
        const addTitle = (title: string) => { doc.setFontSize(14); doc.text(title, 32, y); y += 12; };
        const addSpacer = () => { y += 10; };

        if (sections.dashboard) {
          addTitle('Dashboard');
          doc.setFontSize(11);
          doc.text(`Sensores totales: ${this.totalSensors} | Activos: ${this.activeSensors} | Inactivos: ${this.inactiveSensors} | Alertas activas: ${this.activeAlerts}`, 32, y);
          addSpacer();
        }

        if (sections.sensores) {
          addTitle('Estado de sensores');
          // @ts-ignore
          autoTable(doc, {
            startY: y,
            head: [['Nombre', 'Estado', 'Última lectura']],
            body: (this.sensoresFiltrados.length ? this.sensoresFiltrados : this.sensors).map(s => [s.name, s.status, this.formatDate(s.lastUpdate)])
          });
          // @ts-ignore
          y = (doc as any).lastAutoTable.finalY + 16;
        }

        if (sections.alertasSistema) {
          addTitle('Alertas del Sistema');
          // @ts-ignore
          autoTable(doc, {
            startY: y,
            head: [['Sensor', 'Severidad', 'Mensaje', 'Usuario', 'Fecha']],
            body: (this.alertasFiltradas.length ? this.alertasFiltradas : this.alertasData).map((a: any) => [a.sensor, a.severidad, a.mensaje || a.descripcion || '', (a.usuario || a.usuario_nombre || a.correo || a.email || '—'), this.formatDate(a.timestamp || a.creado_en)])
          });
          // @ts-ignore
          y = (doc as any).lastAutoTable.finalY + 16;
        }

        if (sections.alertasPersonalizadas) {
          addTitle('Alertas Personalizadas');
          // @ts-ignore
          autoTable(doc, {
            startY: y,
            head: [['Sensor', 'Severidad', 'Mensaje', 'Usuario', 'Fecha']],
            body: (this.alertasPersonalizadasFiltradas.length ? this.alertasPersonalizadasFiltradas : this.alertasPersonalizadasData).map((a: any) => [a.sensor, a.severidad, a.mensaje || a.descripcion || '', (a.usuario || a.usuario_nombre || a.correo || a.email || '—'), this.formatDate(a.timestamp || a.creado_en)])
          });
          // @ts-ignore
          y = (doc as any).lastAutoTable.finalY + 16;
        }

        if (sections.notificaciones) {
          addTitle('Notificaciones');
          // @ts-ignore
          autoTable(doc, {
            startY: y,
            head: [['Usuario', 'Título', 'Mensaje', 'Tipo', 'Sensor', 'Estado', 'Fecha']],
            body: this.notificacionesDataSource.data.map((n: any) => [
              this.usuariosMap.get(n.usuario_id) || 'Usuario',
              n.titulo || '',
              n.mensaje || '',
              n.tipo || '',
              n.sensor_codigo === 'general' ? 'General' : n.sensor_codigo || '',
              n.estado || '',
              this.formatDate(n.fecha_creacion || n.creado_en)
            ])
          });
          // @ts-ignore
          y = (doc as any).lastAutoTable.finalY + 16;
        }

        if (sections.usuarios && this.usuariosData?.actividad_usuarios) {
          addTitle('Usuarios');
          // @ts-ignore
          autoTable(doc, {
            startY: y,
            head: [['Usuario', 'Rol', 'Sensores', 'Conectado', 'Última sesión', 'Total lecturas']],
            body: this.usuariosData.actividad_usuarios.map((u: any) => [
              `${u.nombre} (${u.email})`,
              u.rol,
              this.stringifySensoresAsignados(u.sensores_asignados),
              u.esta_conectado ? 'Sí' : 'No',
              this.formatDate(u.ultima_conexion),
              u.total_lecturas ?? 0
            ])
          });
          // @ts-ignore
          y = (doc as any).lastAutoTable.finalY + 16;
        }

        if (sections.analisisTemporal) {
          addTitle('Análisis temporal (gráfico)');
          const dataUrl = this.renderTemporalChartToDataUrl(560, 280);
          if (dataUrl) {
            doc.addImage(dataUrl, 'PNG', 24, y, 560, 280);
            y += 280 + 12;
          } else {
            const resumen = [
              ['MQ-135 (rojo)', String(this.pm25Data.length)],
              ['MQ-7 (amarillo)', String(this.airQualityData.length)],
              ['MQ-4 (azul)', String(this.methaneData.length)]
            ];
            // @ts-ignore
            autoTable(doc, { startY: y, head: [['Serie', 'Nº puntos']], body: resumen });
            // @ts-ignore
            y = (doc as any).lastAutoTable.finalY + 16;
          }
        }

        doc.save('reporte_admin.pdf');
      });
    });
  }

  private svgToPngDataUrl(svgEl: SVGSVGElement, width: number, height: number): Promise<string> {
    return new Promise((resolve) => {
      const serializer = new XMLSerializer();
      let svgStr = serializer.serializeToString(svgEl);
      if (!svgStr.match(/^<svg[^>]+xmlns=/)) {
        svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/png'));
        } else {
          resolve('');
        }
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    });
  }

  private renderTemporalChartToDataUrl(width: number, height: number): string | null {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const margin = { left: 40, right: 20, top: 20, bottom: 30 };
      const plotW = width - margin.left - margin.right;
      const plotH = height - margin.top - margin.bottom;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      // Grid
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      for (let x = 0; x <= plotW; x += 50) {
        ctx.beginPath(); ctx.moveTo(margin.left + x, margin.top); ctx.lineTo(margin.left + x, margin.top + plotH); ctx.stroke();
      }
      for (let y = 0; y <= plotH; y += 30) {
        ctx.beginPath(); ctx.moveTo(margin.left, margin.top + y); ctx.lineTo(margin.left + plotW, margin.top + y); ctx.stroke();
      }
      const drawSeries = (data: any[], color: string) => {
        if (!data || data.length === 0) return;
        const values = data.map(d => d.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const rng = max - min || 1;
        const stepX = plotW / Math.max(1, data.length - 1);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        data.forEach((p, i) => {
          const x = margin.left + i * stepX;
          const y = margin.top + plotH - ((p.value - min) / rng) * plotH;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        // points
        ctx.fillStyle = color;
        data.forEach((p, i) => {
          const x = margin.left + i * stepX;
          const y = margin.top + plotH - ((p.value - min) / rng) * plotH;
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        });
      };
      drawSeries(this.pm25Data, '#ef4444'); // MQ-135 rojo
      drawSeries(this.airQualityData, '#f59e0b'); // MQ-7 amarillo
      drawSeries(this.methaneData, '#3b82f6'); // MQ-4 azul
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  private exportarCSV(sections: any): void {
    let csv = '';
    const push = (title: string, head: string[], rows: string[][]) => {
      csv += `${title}\n`;
      csv += head.join(',') + '\n';
      rows.forEach(r => { csv += r.map(v => '"' + (v ?? '') + '"').join(',') + '\n'; });
      csv += '\n';
    };

    if (sections.dashboard) {
      push('Dashboard', ['Sensores totales','Activos','Inactivos','Alertas activas'], [[
        String(this.totalSensors), String(this.activeSensors), String(this.inactiveSensors), String(this.activeAlerts)
      ]]);
    }
    if (sections.sensores) {
      const lista = (this.sensoresFiltrados.length ? this.sensoresFiltrados : this.sensors).map((s: any) => [s.name, s.status, this.formatDate(s.lastUpdate)]);
      push('Sensores', ['Nombre','Estado','Última lectura'], lista);
    }
    if (sections.alertasSistema) {
      const lista = (this.alertasFiltradas.length ? this.alertasFiltradas : this.alertasData).map((a: any) => [a.sensor, a.severidad, a.mensaje || a.descripcion || '', (a.usuario || a.usuario_nombre || a.correo || a.email || '—'), this.formatDate(a.timestamp || a.creado_en)]);
      push('Alertas del Sistema', ['Sensor','Severidad','Mensaje','Usuario','Fecha'], lista);
    }
    if (sections.alertasPersonalizadas) {
      const lista = (this.alertasPersonalizadasFiltradas.length ? this.alertasPersonalizadasFiltradas : this.alertasPersonalizadasData).map((a: any) => [a.sensor, a.severidad, a.mensaje || a.descripcion || '', (a.usuario || a.usuario_nombre || a.correo || a.email || '—'), this.formatDate(a.timestamp || a.creado_en)]);
      push('Alertas Personalizadas', ['Sensor','Severidad','Mensaje','Usuario','Fecha'], lista);
    }
    if (sections.notificaciones) {
      const lista = this.notificacionesDataSource.data.map((n: any) => [
        this.usuariosMap.get(n.usuario_id) || 'Usuario',
        n.titulo || '',
        n.mensaje || '',
        n.tipo || '',
        n.sensor_codigo === 'general' ? 'General' : n.sensor_codigo || '',
        n.estado || '',
        this.formatDate(n.fecha_creacion || n.creado_en)
      ]);
      push('Notificaciones', ['Usuario','Título','Mensaje','Tipo','Sensor','Estado','Fecha'], lista);
    }
    if (sections.usuarios && this.usuariosData?.actividad_usuarios) {
      const lista = this.usuariosData.actividad_usuarios.map((u: any) => [
        `${u.nombre} (${u.email})`, u.rol, this.stringifySensoresAsignados(u.sensores_asignados), u.esta_conectado ? 'Sí' : 'No', this.formatDate(u.ultima_conexion), String(u.total_lecturas ?? 0)
      ]);
      push('Usuarios', ['Usuario','Rol','Sensores','Conectado','Última sesión','Total lecturas'], lista);
    }
    if (sections.analisisTemporal) {
      const lista = [
        ...this.pm25Data.map((p: any) => ['MQ-135', String(p.value), p.time]),
        ...this.airQualityData.map((p: any) => ['MQ-7', String(p.value), p.time]),
        ...this.methaneData.map((p: any) => ['MQ-4', String(p.value), p.time])
      ];
      push('Análisis Temporal', ['Serie','Valor','Intervalo'], lista);
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reporte_admin.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private exportarExcel(sections: any): void {
    let html = '<html><head><meta charset="UTF-8"></head><body>';
    const table = (title: string, head: string[], rows: string[][]) => {
      html += `<h3>${title}</h3><table border="1"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`;
      html += rows.map(r => `<tr>${r.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('');
      html += '</tbody></table>';
    };
    if (sections.dashboard) {
      table('Dashboard', ['Sensores totales','Activos','Inactivos','Alertas activas'], [[
        String(this.totalSensors), String(this.activeSensors), String(this.inactiveSensors), String(this.activeAlerts)
      ]]);
    }
    if (sections.sensores) {
      const lista = (this.sensoresFiltrados.length ? this.sensoresFiltrados : this.sensors).map((s: any) => [s.name, s.status, this.formatDate(s.lastUpdate)]);
      table('Sensores', ['Nombre','Estado','Última lectura'], lista);
    }
    if (sections.alertasSistema) {
      const lista = (this.alertasFiltradas.length ? this.alertasFiltradas : this.alertasData).map((a: any) => [a.sensor, a.severidad, a.mensaje || a.descripcion || '', (a.usuario || a.usuario_nombre || a.correo || a.email || '—'), this.formatDate(a.timestamp || a.creado_en)]);
      table('Alertas del Sistema', ['Sensor','Severidad','Mensaje','Usuario','Fecha'], lista);
    }
    if (sections.alertasPersonalizadas) {
      const lista = (this.alertasPersonalizadasFiltradas.length ? this.alertasPersonalizadasFiltradas : this.alertasPersonalizadasData).map((a: any) => [a.sensor, a.severidad, a.mensaje || a.descripcion || '', (a.usuario || a.usuario_nombre || a.correo || a.email || '—'), this.formatDate(a.timestamp || a.creado_en)]);
      table('Alertas Personalizadas', ['Sensor','Severidad','Mensaje','Usuario','Fecha'], lista);
    }
    if (sections.notificaciones) {
      const lista = this.notificacionesDataSource.data.map((n: any) => [
        this.usuariosMap.get(n.usuario_id) || 'Usuario',
        n.titulo || '',
        n.mensaje || '',
        n.tipo || '',
        n.sensor_codigo === 'general' ? 'General' : n.sensor_codigo || '',
        n.estado || '',
        this.formatDate(n.fecha_creacion || n.creado_en)
      ]);
      table('Notificaciones', ['Usuario','Título','Mensaje','Tipo','Sensor','Estado','Fecha'], lista);
    }
    if (sections.usuarios && this.usuariosData?.actividad_usuarios) {
      const lista = this.usuariosData.actividad_usuarios.map((u: any) => [
        `${u.nombre} (${u.email})`, u.rol, this.stringifySensoresAsignados(u.sensores_asignados), u.esta_conectado ? 'Sí' : 'No', this.formatDate(u.ultima_conexion), String(u.total_lecturas ?? 0)
      ]);
      table('Usuarios', ['Usuario','Rol','Sensores','Conectado','Última sesión','Total lecturas'], lista);
    }
    if (sections.analisisTemporal) {
      const lista = [
        ...this.pm25Data.map((p: any) => ['MQ-135', String(p.value), p.time]),
        ...this.airQualityData.map((p: any) => ['MQ-7', String(p.value), p.time]),
        ...this.methaneData.map((p: any) => ['MQ-4', String(p.value), p.time])
      ];
      table('Análisis Temporal', ['Serie','Valor','Intervalo'], lista);
    }
    html += '</body></html>';
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reporte_admin.xls';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private stringifySensoresAsignados(value: any): string {
    try {
      if (Array.isArray(value)) {
        if (value.length === 0) return '';
        const first = value[0];
        if (['string', 'number'].includes(typeof first)) {
          return value.join(', ');
        }
        if (typeof first === 'object') {
          return value.map((s: any) => s?.nombre ?? s?.name ?? s?.sensor ?? s?.codigo ?? (s?.id != null ? String(s.id) : '')).filter(Boolean).join(', ');
        }
      }
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        return Object.values(value).filter(v => v != null).join(', ');
      }
      return '';
    } catch {
      return '';
    }
  }

  // Métodos para el gráfico temporal
  getTemporalXPosition(index: number): number {
    const spacing = 600 / 5; // 6 puntos, 5 espacios
    return 30 + (index * spacing);
  }

  getTemporalYPosition(value: number, sensorType: string): number {
    let data: any[];
    switch (sensorType) {
      case 'pm25':
        data = this.pm25Data || [];
        break;
      case 'air':
        data = this.airQualityData || [];
        break;
      case 'methane':
        data = this.methaneData || [];
        break;
      case 'co':
        data = this.coData || [];
        break;
      default:
        data = this.pm25Data || [];
    }
    
    // Si no hay datos, retornar posición media
    if (!data || data.length === 0) return 150;
    
    const min = Math.min(...data.map(d => d.value));
    const max = Math.max(...data.map(d => d.value));
    const range = max - min;
    const normalizedValue = range > 0 ? (value - min) / range : 0.5; // Evitar división por cero
    return 270 - (normalizedValue * 240) + 15; // Invertir Y y agregar margen
  }

  getTemporalChartPoints(sensorType: string): string {
    let data: any[];
    switch (sensorType) {
      case 'pm25':
        data = this.pm25Data || [];
        break;
      case 'air':
        data = this.airQualityData || [];
        break;
      case 'methane':
        data = this.methaneData || [];
        break;
      case 'co':
        data = this.coData || [];
        break;
      default:
        data = this.pm25Data || [];
    }
    
    // Si no hay datos, retornar string vacío para evitar errores en SVG
    if (!data || data.length === 0) return '';
    
    try {
      return data.map((point, index) => {
        const x = this.getTemporalXPosition(index);
        const y = this.getTemporalYPosition(point.value, sensorType);
        return `${x},${y}`;
      }).join(' ');
    } catch (e) {
      console.error('Error generando puntos temporales:', e);
      return '';
    }
  }

  // Funciones de filtro para usuarios
  getFilteredUsers(): any[] {
    if (!this.usuariosData?.actividad_usuarios) {
      return [];
    }
    
    if (!this.selectedConnectionStatus) {
      return this.usuariosData.actividad_usuarios;
    }
    
    return this.usuariosData.actividad_usuarios.filter((user: any) => {
      if (this.selectedConnectionStatus === 'connected') {
        return user.esta_conectado === true;
      } else if (this.selectedConnectionStatus === 'disconnected') {
        return user.esta_conectado === false;
      }
      return true;
    });
  }

  onConnectionStatusChange(): void {
    this.usuariosFiltrados = this.getFilteredUsers();
    this.usuariosCurrentPage = 0;
    this.inicializarPaginacionUsuarios();
  }

  // Funciones de paginación para usuarios
  inicializarPaginacionUsuarios(): void {
    const usuariosParaPaginacion = this.usuariosFiltrados.length > 0 ? this.usuariosFiltrados : this.usuariosData?.actividad_usuarios || [];
    this.usuariosTotalPages = Math.ceil(usuariosParaPaginacion.length / this.usuariosPageSize);
    this.cargarPaginaUsuarios(0);
  }

  cargarPaginaUsuarios(page: number): void {
    const usuariosParaPaginacion = this.usuariosFiltrados.length > 0 ? this.usuariosFiltrados : this.usuariosData?.actividad_usuarios || [];
    const startIndex = page * this.usuariosPageSize;
    const endIndex = startIndex + this.usuariosPageSize;
    this.usuariosPaginados = usuariosParaPaginacion.slice(startIndex, endIndex);
    this.usuariosCurrentPage = page;
  }

  siguientePaginaUsuarios(): void {
    if (this.usuariosCurrentPage < this.usuariosTotalPages - 1) {
      this.cargarPaginaUsuarios(this.usuariosCurrentPage + 1);
    }
  }

  paginaAnteriorUsuarios(): void {
    if (this.usuariosCurrentPage > 0) {
      this.cargarPaginaUsuarios(this.usuariosCurrentPage - 1);
    }
  }

  irAPaginaUsuarios(page: number): void {
    if (page >= 0 && page < this.usuariosTotalPages) {
      this.cargarPaginaUsuarios(page);
    }
  }

}

// ---------- Diálogo de Exportación ----------
// (usamos los módulos ya importados arriba en el archivo)

@Component({
  selector: 'app-export-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatRadioModule, MatCheckboxModule, MatButtonModule, MatIconModule, MatCardModule, MatDividerModule],
  template: `
  <div class="dialog-header">
    <mat-icon class="header-icon">file_download</mat-icon>
    <h2 mat-dialog-title>Exportar Reportes</h2>
  </div>
  
  <mat-dialog-content>
    <!-- Formato de exportación -->
    <mat-card class="format-card">
      <mat-card-header>
        <mat-card-title>Formato de Exportación</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <mat-radio-group [(ngModel)]="type" class="format-group">
          <mat-radio-button value="pdf" class="format-option">
            <mat-icon>picture_as_pdf</mat-icon>
            <span>PDF</span>
            <small>Documento completo con gráficos</small>
          </mat-radio-button>
          <mat-radio-button value="excel" class="format-option">
            <mat-icon>table_chart</mat-icon>
            <span>Excel</span>
            <small>Hoja de cálculo editable</small>
          </mat-radio-button>
          <mat-radio-button value="csv" class="format-option">
            <mat-icon>text_snippet</mat-icon>
            <span>CSV</span>
            <small>Datos separados por comas</small>
          </mat-radio-button>
        </mat-radio-group>
      </mat-card-content>
    </mat-card>

    <!-- Secciones a incluir -->
    <mat-card class="sections-card">
      <mat-card-header>
        <mat-card-title>Secciones a Incluir</mat-card-title>
        <mat-card-subtitle>Selecciona qué datos incluir en el reporte</mat-card-subtitle>
      </mat-card-header>
      <mat-card-content>
        <div class="sections-grid">
          <!-- Dashboard -->
          <div class="section-item" [class.selected]="sections.dashboard">
            <mat-checkbox [(ngModel)]="sections.dashboard" color="primary">
              <div class="section-content">
                <mat-icon>dashboard</mat-icon>
                <div class="section-text">
                  <span class="section-title">Dashboard</span>
                  <small>Métricas generales del sistema</small>
                </div>
              </div>
            </mat-checkbox>
          </div>

          <!-- Sensores -->
          <div class="section-item" [class.selected]="sections.sensores">
            <mat-checkbox [(ngModel)]="sections.sensores" color="primary">
              <div class="section-content">
                <mat-icon>sensors</mat-icon>
                <div class="section-text">
                  <span class="section-title">Estado de Sensores</span>
                  <small>Estado actual y valores de sensores</small>
                </div>
              </div>
            </mat-checkbox>
          </div>

          <!-- Alertas del Sistema -->
          <div class="section-item" [class.selected]="sections.alertasSistema">
            <mat-checkbox [(ngModel)]="sections.alertasSistema" color="primary">
              <div class="section-content">
                <mat-icon>warning</mat-icon>
                <div class="section-text">
                  <span class="section-title">Alertas del Sistema</span>
                  <small>Alertas automáticas generadas por sensores</small>
                </div>
              </div>
            </mat-checkbox>
          </div>

          <!-- Alertas Personalizadas -->
          <div class="section-item" [class.selected]="sections.alertasPersonalizadas">
            <mat-checkbox [(ngModel)]="sections.alertasPersonalizadas" color="primary">
              <div class="section-content">
                <mat-icon>notifications_active</mat-icon>
                <div class="section-text">
                  <span class="section-title">Alertas Personalizadas</span>
                  <small>Alertas configuradas manualmente</small>
                </div>
              </div>
            </mat-checkbox>
          </div>

          <!-- Notificaciones -->
          <div class="section-item" [class.selected]="sections.notificaciones">
            <mat-checkbox [(ngModel)]="sections.notificaciones" color="primary">
              <div class="section-content">
                <mat-icon>notifications</mat-icon>
                <div class="section-text">
                  <span class="section-title">Notificaciones</span>
                  <small>Notificaciones enviadas a usuarios</small>
                </div>
              </div>
            </mat-checkbox>
          </div>

          <!-- Usuarios -->
          <div class="section-item" [class.selected]="sections.usuarios">
            <mat-checkbox [(ngModel)]="sections.usuarios" color="primary">
              <div class="section-content">
                <mat-icon>people</mat-icon>
                <div class="section-text">
                  <span class="section-title">Usuarios</span>
                  <small>Lista de usuarios y su actividad</small>
                </div>
              </div>
            </mat-checkbox>
          </div>

          <!-- Análisis Temporal -->
          <div class="section-item" [class.selected]="sections.analisisTemporal">
            <mat-checkbox [(ngModel)]="sections.analisisTemporal" color="primary">
              <div class="section-content">
                <mat-icon>timeline</mat-icon>
                <div class="section-text">
                  <span class="section-title">Análisis Temporal</span>
                  <small>Datos históricos y tendencias</small>
                </div>
              </div>
            </mat-checkbox>
          </div>
        </div>

        <!-- Validación -->
        <div *ngIf="!hasAnySectionSelected()" class="validation-error">
          <mat-icon>error</mat-icon>
          <span>Debes seleccionar al menos una sección para exportar</span>
        </div>
      </mat-card-content>
    </mat-card>
  </mat-dialog-content>
  
  <mat-dialog-actions align="end">
    <button mat-button (click)="dialogRef.close()">
      <mat-icon>close</mat-icon>
      Cancelar
    </button>
    <button mat-flat-button color="primary" [disabled]="!hasAnySectionSelected()" (click)="confirmar()">
      <mat-icon>file_download</mat-icon>
      Exportar
    </button>
  </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 24px 24px 0 24px;
      border-bottom: 1px solid #e0e0e0;
      margin-bottom: 16px;
    }
    
    .header-icon {
      color: #1976d2;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }
    
    .dialog-header h2 {
      margin: 0;
      color: #333;
      font-size: 1.5rem;
      font-weight: 600;
    }

    .format-card, .sections-card {
      margin-bottom: 16px;
      border: 1px solid #e0e0e0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .format-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .format-option {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      transition: all 0.2s ease;
    }

    .format-option:hover {
      background-color: #f5f5f5;
    }

    .format-option mat-icon {
      color: #666;
    }

    .format-option span {
      font-weight: 500;
      color: #333;
    }

    .format-option small {
      color: #666;
      margin-left: auto;
    }

    .sections-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }

    .section-item {
      padding: 16px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      transition: all 0.2s ease;
      cursor: pointer;
    }

    .section-item:hover {
      background-color: #f8f9fa;
      border-color: #1976d2;
    }

    .section-item.selected {
      background-color: #e3f2fd;
      border-color: #1976d2;
      box-shadow: 0 2px 8px rgba(25, 118, 210, 0.2);
    }

    .section-content {
      display: flex;
      align-items: center;
      gap: 12px;
      pointer-events: none;
    }

    .section-content mat-icon {
      color: #666;
      font-size: 20px;
    }

    .section-item.selected .section-content mat-icon {
      color: #1976d2;
    }

    .section-text {
      display: flex;
      flex-direction: column;
    }

    .section-title {
      font-weight: 500;
      color: #333;
      font-size: 0.9rem;
    }

    .section-item.selected .section-title {
      color: #1976d2;
      font-weight: 600;
    }

    .section-text small {
      color: #666;
      font-size: 0.75rem;
      margin-top: 2px;
    }

    .section-item.selected .section-text small {
      color: #1976d2;
    }

    mat-checkbox {
      width: 100%;
    }

    mat-checkbox ::ng-deep .mat-checkbox-layout {
      width: 100%;
    }

    mat-checkbox ::ng-deep .mat-checkbox-inner-container {
      margin-right: 12px;
    }

    .validation-error {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #d32f2f;
      background-color: #ffebee;
      padding: 12px;
      border-radius: 4px;
      margin-top: 16px;
      font-size: 0.875rem;
    }

    .validation-error mat-icon {
      font-size: 18px;
    }

    mat-dialog-content {
      max-height: 70vh;
      overflow-y: auto;
    }

    mat-dialog-actions {
      padding: 16px 24px;
      border-top: 1px solid #e0e0e0;
    }

    mat-dialog-actions button {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    @media (max-width: 600px) {
      .sections-grid {
        grid-template-columns: 1fr;
      }
      
      .dialog-header {
        padding: 16px 16px 0 16px;
      }

      .format-group {
        gap: 8px;
      }

      .format-option {
        padding: 8px;
      }
    }
  `]
})
export class ExportDialogComponent {
  type: 'pdf' | 'excel' | 'csv';
  sections: any;
  constructor(@Inject(MAT_DIALOG_DATA) public data: any, public dialogRef: MatDialogRef<ExportDialogComponent>) {
    this.type = data?.type || 'pdf';
    this.sections = data?.sections || { 
      dashboard: true, 
      sensores: true, 
      alertasSistema: true,
      alertasPersonalizadas: true,
      notificaciones: true,
      usuarios: true, 
      analisisTemporal: true 
    };
  }
  confirmar() { 
    if (this.hasAnySectionSelected()) { 
      this.dialogRef.close({ type: this.type, sections: this.sections }); 
    } 
  }
  hasAnySectionSelected(): boolean {
    return !!(this.sections?.dashboard || 
              this.sections?.sensores || 
              this.sections?.alertasSistema ||
              this.sections?.alertasPersonalizadas ||
              this.sections?.notificaciones ||
              this.sections?.usuarios || 
              this.sections?.analisisTemporal);
  }
}

@Component({
  selector: 'app-notif-edit-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatIconModule, MatCardModule],
  template: `
  <div class="dialog-header">
    <mat-icon class="header-icon">edit</mat-icon>
    <h2 mat-dialog-title>Editar Notificación</h2>
  </div>
  
  <mat-dialog-content>
    <div class="dialog-grid">
      <mat-form-field appearance="outline">
        <mat-label>Usuario</mat-label>
        <mat-select [(ngModel)]="data.usuario_id">
          <mat-option *ngFor="let u of (data.usuarios || [])" [value]="u.id">{{ u.nombre }}</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Sensor</mat-label>
        <mat-select [(ngModel)]="data.sensor_codigo">
          <mat-option value="general">General</mat-option>
          <mat-option value="mq135">MQ-135</mat-option>
          <mat-option value="mq7">MQ-7</mat-option>
          <mat-option value="mq4">MQ-4</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Valor</mat-label>
        <input matInput type="number" [(ngModel)]="data.valor" />
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Estado</mat-label>
        <mat-select [(ngModel)]="data.estado">
          <mat-option value="bueno">Bueno</mat-option>
          <mat-option value="advertencia">Advertencia</mat-option>
          <mat-option value="malo">Malo</mat-option>
          <mat-option value="desconectado">Desconectado</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" class="full">
        <mat-label>Título</mat-label>
        <input matInput [(ngModel)]="data.titulo" />
      </mat-form-field>
      <mat-form-field appearance="outline" class="full">
        <mat-label>Mensaje</mat-label>
        <textarea matInput [(ngModel)]="data.mensaje" rows="3"></textarea>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Tipo</mat-label>
        <mat-select [(ngModel)]="data.tipo">
          <mat-option value="info">Info</mat-option>
          <mat-option value="warning">Warning</mat-option>
          <mat-option value="danger">Danger</mat-option>
        </mat-select>
      </mat-form-field>
      <div class="full" style="display:flex; align-items:center; gap:.5rem;">
        <mat-checkbox [(ngModel)]="data.leida">Marcada como leída</mat-checkbox>
      </div>
    </div>
  </mat-dialog-content>
  
  <mat-dialog-actions align="end">
    <button mat-button (click)="dialogRef.close()">Cancelar</button>
    <button mat-flat-button color="primary" (click)="guardar()">Guardar</button>
  </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 24px 24px 0 24px;
      border-bottom: 1px solid #eee;
      margin-bottom: 16px;
    }
    
    .header-icon {
      color: #1976d2;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }
    
    .dialog-header h2 {
      margin: 0;
      color: #333;
      font-size: 1.5rem;
      font-weight: 600;
    }
    
    .dialog-grid { 
      display: grid; 
      grid-template-columns: repeat(2, minmax(160px, 1fr)); 
      gap: 1rem; 
    }
    
    .full { grid-column: 1 / -1; }
    
    mat-dialog-content {
      max-height: 70vh;
      overflow-y: auto;
    }
    
    @media (max-width: 600px) {
      .dialog-grid {
        grid-template-columns: 1fr;
      }
      
      .dialog-header {
        padding: 16px 16px 0 16px;
      }
    }
  `]
})
export class NotifEditDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: any, public dialogRef: MatDialogRef<NotifEditDialogComponent>) {}
  guardar() { this.dialogRef.close(this.data); }
}

@Component({
  selector: 'app-notif-create-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatIconModule, MatCardModule, MatChipsModule],
  template: `
  <div class="dialog-header">
    <mat-icon class="header-icon">notifications</mat-icon>
    <h2 mat-dialog-title>Nueva Notificación Personalizada</h2>
  </div>
  
  <mat-dialog-content>
    <div class="dialog-grid">
      <!-- Usuario (Obligatorio) -->
      <mat-form-field appearance="outline" class="full">
        <mat-label>Usuario</mat-label>
        <mat-select [(ngModel)]="data.usuario_id" required>
          <mat-option *ngFor="let u of (data.usuarios || [])" [value]="u.id">
            <div class="user-option">
              <span class="user-name">{{ u.nombre }}</span>
              <span class="user-email">{{ u.email }}</span>
            </div>
          </mat-option>
        </mat-select>
      </mat-form-field>

      <!-- Título (Obligatorio) -->
      <mat-form-field appearance="outline" class="full">
        <mat-label>Título de la notificación</mat-label>
        <input matInput [(ngModel)]="data.titulo" required />
      </mat-form-field>

      <!-- Mensaje (Obligatorio) -->
      <mat-form-field appearance="outline" class="full">
        <mat-label>Mensaje</mat-label>
        <textarea matInput [(ngModel)]="data.mensaje" rows="3" required></textarea>
      </mat-form-field>

      <!-- Tipo de notificación -->
      <mat-form-field appearance="outline">
        <mat-label>Tipo de notificación</mat-label>
        <mat-select [(ngModel)]="data.tipo">
          <mat-option value="info">Informativa</mat-option>
          <mat-option value="warning">Advertencia</mat-option>
          <mat-option value="danger">Urgente</mat-option>
        </mat-select>
      </mat-form-field>

      <!-- Sensor relacionado (Opcional) -->
      <mat-form-field appearance="outline">
        <mat-label>Sensor relacionado</mat-label>
        <mat-select [(ngModel)]="data.sensor_codigo">
          <mat-option value="">Sin sensor específico</mat-option>
          <mat-option value="mq135">MQ-135 (Calidad del aire)</mat-option>
          <mat-option value="mq7">MQ-7 (Monóxido de carbono)</mat-option>
          <mat-option value="mq4">MQ-4 (Metano)</mat-option>
        </mat-select>
      </mat-form-field>

      <!-- Valor del sensor (si se selecciona un sensor) -->
      <mat-form-field appearance="outline" *ngIf="data.sensor_codigo">
        <mat-label>Valor del sensor</mat-label>
        <input matInput type="number" [(ngModel)]="data.valor" step="0.01" />
      </mat-form-field>

      <!-- Estado del sensor (si se selecciona un sensor) -->
      <mat-form-field appearance="outline" *ngIf="data.sensor_codigo">
        <mat-label>Estado del sensor</mat-label>
        <mat-select [(ngModel)]="data.estado">
          <mat-option value="bueno">Bueno</mat-option>
          <mat-option value="advertencia">Advertencia</mat-option>
          <mat-option value="malo">Malo</mat-option>
          <mat-option value="desconectado">Desconectado</mat-option>
        </mat-select>
      </mat-form-field>

      <!-- Opciones adicionales -->
      <div class="full options-section">
        <mat-checkbox [(ngModel)]="data.leida">
          Marcar como leída automáticamente
        </mat-checkbox>
        <mat-checkbox [(ngModel)]="data.prioridad_alta">
          Notificación de alta prioridad
        </mat-checkbox>
      </div>
    </div>
  </mat-dialog-content>
  
  <mat-dialog-actions align="end">
    <button mat-button (click)="dialogRef.close()">Cancelar</button>
    <button mat-flat-button color="primary" (click)="enviar()" 
            [disabled]="!data.usuario_id || !data.titulo || !data.mensaje">
      <mat-icon>send</mat-icon>
      Enviar Notificación
    </button>
  </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 24px 24px 0 24px;
      border-bottom: 1px solid #eee;
      margin-bottom: 16px;
    }
    
    .header-icon {
      color: #1976d2;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }
    
    .dialog-header h2 {
      margin: 0;
      color: #333;
      font-size: 1.5rem;
      font-weight: 600;
    }
    
    .dialog-grid { 
      display: grid; 
      grid-template-columns: repeat(2, minmax(160px, 1fr)); 
      gap: 1rem; 
    }
    
    .full { grid-column: 1 / -1; }
    
    .user-option {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }
    
    .user-name {
      font-weight: 500;
      color: #374151;
    }
    
    .user-email {
      font-size: 0.8rem;
      color: #6b7280;
    }
    
    .options-section {
      margin-top: 16px;
      padding: 16px;
      background: #f5f5f5;
      border-radius: 8px;
      border-left: 4px solid #2196f3;
    }
    
    mat-dialog-content {
      max-height: 70vh;
      overflow-y: auto;
    }
    
    @media (max-width: 600px) {
      .dialog-grid {
        grid-template-columns: 1fr;
      }
      
      .dialog-header {
        padding: 16px 16px 0 16px;
      }
    }
  `]
})
export class NotifCreateDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: any, public dialogRef: MatDialogRef<NotifCreateDialogComponent>) {
    // Valores por defecto
    this.data = {
      ...this.data,
      tipo: 'info',
      sensor_codigo: '',
      valor: 0,
      estado: 'bueno',
      leida: false,
      prioridad_alta: false
    };
  }
  
  enviar() { 
    this.dialogRef.close(this.data); 
  }
}
