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
    NODE_ENV      = "development"
    PORT          = "3000"
    DATABASE_HOST = kubernetes_service_v1.postgres.metadata[0].name
  }
}

# A local teaching credential. Real values belong in a secret manager, and the
# state file that stores this must be protected because it holds the plain text.
variable "database_password" {
  description = "Password shared by PostgreSQL and the API"
  type        = string
  default     = "development"
  sensitive   = true
}

resource "kubernetes_secret_v1" "opslab_db" {
  metadata {
    name      = "opslab-db"
    namespace = kubernetes_namespace_v1.opslab.metadata[0].name
  }

  data = {
    password = var.database_password
  }
}

resource "kubernetes_service_v1" "postgres" {
  metadata {
    name      = "postgres"
    namespace = kubernetes_namespace_v1.opslab.metadata[0].name
  }

  spec {
    # Headless: DNS resolves straight to the pod, which is what a StatefulSet expects.
    cluster_ip = "None"

    selector = {
      app = "postgres"
    }

    port {
      port        = 5432
      target_port = 5432
    }
  }
}

resource "kubernetes_stateful_set_v1" "postgres" {
  metadata {
    name      = "postgres"
    namespace = kubernetes_namespace_v1.opslab.metadata[0].name
  }

  spec {
    service_name = kubernetes_service_v1.postgres.metadata[0].name
    replicas     = 1

    selector {
      match_labels = {
        app = "postgres"
      }
    }

    template {
      metadata {
        labels = {
          app = "postgres"
        }
      }

      spec {
        container {
          name  = "postgres"
          image = "postgres:16-alpine"

          port {
            container_port = 5432
          }

          env {
            name  = "POSTGRES_DB"
            value = "opslab"
          }

          env {
            name  = "POSTGRES_USER"
            value = "opslab"
          }

          env {
            name = "POSTGRES_PASSWORD"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.opslab_db.metadata[0].name
                key  = "password"
              }
            }
          }

          env {
            name  = "PGDATA"
            value = "/var/lib/postgresql/data/pgdata"
          }

          readiness_probe {
            exec {
              command = ["pg_isready", "-U", "opslab", "-d", "opslab"]
            }

            initial_delay_seconds = 5
            period_seconds        = 5
          }

          resources {
            requests = {
              cpu    = "50m"
              memory = "128Mi"
            }
            limits = {
              memory = "256Mi"
            }
          }

          volume_mount {
            name       = "data"
            mount_path = "/var/lib/postgresql/data"
          }
        }
      }
    }

    volume_claim_template {
      metadata {
        name = "data"
      }

      spec {
        access_modes = ["ReadWriteOnce"]

        resources {
          requests = {
            storage = "1Gi"
          }
        }
      }
    }
  }
}

resource "kubernetes_deployment_v1" "opslab_api" {
  metadata {
    name      = "opslab-api"
    namespace = kubernetes_namespace_v1.opslab.metadata[0].name
  }

  spec {
    replicas = 2

    strategy {
      type = "RollingUpdate"

      rolling_update {
        max_surge       = "1"
        max_unavailable = "0"
      }
    }

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
        security_context {
          run_as_non_root = true
          run_as_user     = 1000

          seccomp_profile {
            type = "RuntimeDefault"
          }
        }

        container {
          name              = "opslab-api"
          image             = "opslab-api:local"
          image_pull_policy = "IfNotPresent"

          port {
            container_port = 3000
          }

          dynamic "env" {
            for_each = toset(["NODE_ENV", "PORT", "DATABASE_HOST"])

            content {
              name = env.value
              value_from {
                config_map_key_ref {
                  name = kubernetes_config_map_v1.opslab_config.metadata[0].name
                  key  = env.value
                }
              }
            }
          }

          env {
            name = "DATABASE_PASSWORD"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.opslab_db.metadata[0].name
                key  = "password"
              }
            }
          }

          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true

            capabilities {
              drop = ["ALL"]
            }
          }

          # CPU requests are what a HorizontalPodAutoscaler measures utilisation against.
          resources {
            requests = {
              cpu    = "50m"
              memory = "96Mi"
            }
            limits = {
              memory = "192Mi"
            }
          }

          # Gives a slow start up to 60 s before the other probes begin.
          startup_probe {
            http_get {
              path = "/health/live"
              port = 3000
            }

            period_seconds    = 2
            failure_threshold = 30
          }

          readiness_probe {
            http_get {
              path = "/health/ready"
              port = 3000
            }

            period_seconds    = 5
            failure_threshold = 2
          }

          liveness_probe {
            http_get {
              path = "/health/live"
              port = 3000
            }

            period_seconds = 15
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

# Voluntary disruptions, such as a node drain, must leave at least one API pod running.
resource "kubernetes_pod_disruption_budget_v1" "opslab_api" {
  metadata {
    name      = "opslab-api"
    namespace = kubernetes_namespace_v1.opslab.metadata[0].name
  }

  spec {
    min_available = "1"

    selector {
      match_labels = {
        app = "opslab-api"
      }
    }
  }
}
