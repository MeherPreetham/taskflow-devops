pipeline {
    agent {
        kubernetes {
            yaml """
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins
  containers:
  - name: jnlp
    image: jenkins-agent-docker-kubectl:latest
    imagePullPolicy: Never
    securityContext:
      runAsUser: 0
    volumeMounts:
    - name: docker-sock
      mountPath: /var/run/docker.sock
  volumes:
  - name: docker-sock
    hostPath:
      path: /var/run/docker.sock
"""
        }
    }
    
    environment {
        IMAGE_TAG = "v${BUILD_NUMBER}"
    }
    
    stages {
        stage('Build User Service') {
            steps {
                echo "Building user-service..."
                sh '''
                    cd services/user-service
                    docker build -t user-service:${IMAGE_TAG} .
                    docker tag user-service:${IMAGE_TAG} user-service:latest
                '''
            }
        }
        
        stage('Build Task Service') {
            steps {
                echo "Building task-service..."
                sh '''
                    cd services/task-service
                    docker build -t task-service:${IMAGE_TAG} .
                    docker tag task-service:${IMAGE_TAG} task-service:latest
                '''
            }
        }
        
        stage('Deploy Services') {
            steps {
                echo "Deploying to Kubernetes..."
                sh '''
                    kubectl set image deployment/user-service user-service=user-service:${IMAGE_TAG} -n default
                    kubectl set image deployment/task-service task-service=task-service:${IMAGE_TAG} -n default
                    kubectl rollout status deployment/user-service -n default
                    kubectl rollout status deployment/task-service -n default
                '''
            }
        }
    }
}
