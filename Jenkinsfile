pipeline {
    agent {
        kubernetes {
            yamlFile 'infrastructure/kubernetes/jenkins-agent-pod-template.yaml'
        }
    }
    
    environment {
        IMAGE_TAG = "v${BUILD_NUMBER}"
    }
    
    stages {
        stage('Build User Service') {
            steps {
                echo "Building user-service:${IMAGE_TAG}..."
                sh '''
                    cd services/user-service
                    docker build -t user-service:${IMAGE_TAG} .
                    docker tag user-service:${IMAGE_TAG} user-service:latest
                '''
            }
        }
        
        stage('Build Task Service') {
            steps {
                echo "Building task-service:${IMAGE_TAG}..."
                sh '''
                    cd services/task-service
                    docker build -t task-service:${IMAGE_TAG} .
                    docker tag task-service:${IMAGE_TAG} task-service:latest
                '''
            }
        }
        
        stage('Update Manifests') {
            steps {
                echo "Updating image tags in manifests..."
                sh '''
                    sed -i "s|image: user-service:.*|image: user-service:${IMAGE_TAG}|g" infrastructure/kubernetes/user-service-deployment.yaml
                    sed -i "s|image: task-service:.*|image: task-service:${IMAGE_TAG}|g" infrastructure/kubernetes/task-service-deployment.yaml
                '''
            }
        }
        
        stage('Deploy to Kubernetes') {
            steps {
                echo "Deploying updated manifests..."
                sh '''
                    kubectl apply -f infrastructure/kubernetes/user-service-deployment.yaml
                    kubectl apply -f infrastructure/kubernetes/task-service-deployment.yaml
                    kubectl rollout status deployment/user-service -n default
                    kubectl rollout status deployment/task-service -n default
                '''
            }
        }
    }
    
    post {
        success {
            echo "Deployment successful! Services running on version ${IMAGE_TAG}"
        }
        failure {
            echo "Deployment failed. Check logs above."
        }
    }
}
