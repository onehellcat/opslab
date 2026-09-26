resource "kubernetes_namespace_v1" "opslab" {
  metadata {
    name = "opslab"
  }
}

resource "kubernetes_config_map_v1" "opslab_config" {
  metadata {
    name      = "opslab-config"
    namespace = kubernetes_namespace_v1.opslab.metadata[0].name
  }

  data = {
    NODE_ENV = "development"
    PORT     = "3000"
  }
}

resource "kubernetes_deployment_v1" "opslab_api" {
  metadata {
    name      = "opslab-api"
    namespace = kubernetes_namespace_v1.opslab.metadata[0].name
  }

  spec {
    replicas = 2

    selector {
      match_labels = {
        app = "opslab-api"
      }
    }

    template {
      metadata {
        labels = {
          app = "opslab-api"
        }
      }

      spec {
        container {
          name  = "opslab-api"
          image = "opslab-api:local"

          port {
            container_port = 3000
          }

          env {
            name = "NODE_ENV"
            value_from {
              config_map_key_ref {
                name = kubernetes_config_map_v1.opslab_config.metadata[0].name
                key  = "NODE_ENV"
              }
            }
          }

          env {
            name = "PORT"
            value_from {
              config_map_key_ref {
                name = kubernetes_config_map_v1.opslab_config.metadata[0].name
                key  = "PORT"
              }
            }
          }

          readiness_probe {
            http_get {
              path = "/health/ready"
              port = 3000
            }

            initial_delay_seconds = 5
            period_seconds        = 10
          }

          liveness_probe {
            http_get {
              path = "/health/live"
              port = 3000
            }

            initial_delay_seconds = 10
            period_seconds        = 15
          }
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "opslab_api" {
  metadata {
    name      = "opslab-api"
    namespace = kubernetes_namespace_v1.opslab.metadata[0].name
  }

  spec {
    selector = {
      app = "opslab-api"
    }

    port {
      port        = 80
      target_port = 3000
    }

    type = "ClusterIP"
  }
}
