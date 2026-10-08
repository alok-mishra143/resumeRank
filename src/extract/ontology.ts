// Semantic skill ontology: canonical names, aliases, and one-way implication
// edges ("implies" = knowing this skill means you also know the parent).
//
// This is what makes "AWS matches S3" work: an S3 (or Lambda, or EKS) mention
// on a resume satisfies a requirement for AWS, because S3 implies AWS. The
// reverse direction is *partial* credit, not full: a resume that only says
// "AWS" gets SEMANTIC_DESCENDANT_CREDIT when the requirement is "S3".
//
// Alias convention: an alias prefixed with "*" is matched case-sensitively
// (short tokens like Go / R / C / TS that are common words when lowercased).

export interface SkillDef {
  name: string
  aliases?: string[]
  /** Broader skills this one implies (transitively expanded at load). */
  implies?: string[]
  category?: SkillCategory
  /**
   * Umbrella skills: useful as implication targets for semantic matching, but
   * never emitted as a candidate's own skill (a resume saying "backend
   * engineer" does not thereby "have Backend" as a skill).
   */
  abstract?: boolean
}

export type SkillCategory =
  | "language"
  | "frontend"
  | "backend"
  | "mobile"
  | "database"
  | "cloud"
  | "devops"
  | "data"
  | "ml"
  | "testing"
  | "security"
  | "tooling"
  | "practice"
  | "design"
  | "product"

export const SKILLS: SkillDef[] = [
  // --- abstract umbrella skills (targets of implication edges) -------------
  { name: "Programming", category: "practice", abstract: true },
  { name: "Frontend", category: "frontend", abstract: true },
  { name: "Backend", category: "backend", abstract: true },
  { name: "Full Stack", category: "practice", implies: ["Frontend", "Backend"], abstract: true },
  { name: "Mobile", category: "mobile", abstract: true },
  { name: "Cloud", category: "cloud", abstract: true },
  { name: "DevOps", category: "devops", implies: ["Cloud"], abstract: true },
  { name: "Site Reliability", aliases: ["sre", "site reliability engineering"], category: "devops", implies: ["DevOps"], abstract: true },
  { name: "Data Engineering", category: "data" },
  { name: "Analytics", aliases: ["analytics", "data analytics"], category: "data" },
  { name: "Big Data", category: "data" },
  { name: "Data Warehouse", category: "data" },
  { name: "Business Intelligence", aliases: ["business intelligence", "*BI"], category: "data" },
  { name: "Machine Learning", category: "ml" },
  { name: "Deep Learning", category: "ml", implies: ["Machine Learning"] },
  { name: "Generative AI", category: "ml", implies: ["Machine Learning"] },
  { name: "Natural Language Processing", category: "ml", implies: ["Machine Learning"] },
  { name: "Computer Vision", category: "ml", implies: ["Machine Learning"] },
  { name: "MLOps", category: "ml", implies: ["Machine Learning", "DevOps"] },
  { name: "Testing", category: "testing" },
  { name: "Test Automation", aliases: ["test automation", "automated testing"], category: "testing", implies: ["Testing"] },
  { name: "Performance Testing", category: "testing", implies: ["Testing"] },
  { name: "Security", category: "security" },
  { name: "Networking", category: "devops", abstract: true },
  { name: "Databases", aliases: ["databases", "database"], category: "database", abstract: true },
  { name: "Relational Databases", category: "database", implies: ["Databases"], abstract: true },
  { name: "NoSQL", aliases: ["nosql", "non-relational"], category: "database", implies: ["Databases"], abstract: true },
  { name: "Search Engines", category: "database", abstract: true },
  { name: "Caching", category: "backend", abstract: true },
  { name: "Streaming", category: "data", abstract: true },
  { name: "Message Queues", category: "backend" },
  { name: "System Design", category: "practice" },
  { name: "Distributed Systems", category: "practice", implies: ["System Design"] },
  { name: "Microservices", aliases: ["microservice", "microservices"], category: "backend", implies: ["System Design"] },
  { name: "REST APIs", aliases: ["rest api", "restful", "*REST", "rest apis"], category: "backend" },
  { name: "GraphQL", category: "backend", abstract: true },
  { name: "WebSockets", aliases: ["websocket", "websockets"], category: "backend", abstract: true },
  { name: "Containers", aliases: ["containers", "containerization"], category: "devops", abstract: true },
  { name: "Orchestration", category: "devops", abstract: true },
  { name: "Infrastructure as Code", aliases: ["infrastructure as code", "*IaC"], category: "devops", abstract: true },
  { name: "CI/CD", aliases: ["ci/cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment"], category: "devops" },
  { name: "Observability", aliases: ["monitoring", "observability"], category: "devops" },
  { name: "Agile", aliases: ["agile", "scrum", "kanban"], category: "practice" },
  { name: "Accessibility", aliases: ["a11y", "wcag", "accessibility"], category: "frontend" },
  { name: "UI/UX", aliases: ["ui/ux", "user experience", "ux design"], category: "design" },
  { name: "Product Management", aliases: ["product management", "product owner"], category: "product", abstract: true },

  // --- languages ----------------------------------------------------------
  { name: "JavaScript", aliases: ["javascript", "*JS", "es6", "es2015", "ecmascript"], implies: ["Programming"], category: "language" },
  { name: "TypeScript", aliases: ["typescript", "*TS"], implies: ["JavaScript", "Programming"], category: "language" },
  { name: "Python", aliases: ["python", "python3"], implies: ["Programming"], category: "language" },
  { name: "Java", aliases: ["java", "java 8", "java 11", "java 17"], implies: ["Programming"], category: "language" },
  { name: "Kotlin", implies: ["Java", "Programming"], category: "language" },
  { name: "Scala", implies: ["Java", "Programming"], category: "language" },
  { name: "Groovy", implies: ["Java", "Programming"], category: "language" },
  { name: "C", aliases: ["*C", "c language"], implies: ["Programming"], category: "language" },
  { name: "C++", aliases: ["*C++", "cplusplus", "cpp"], implies: ["C", "Programming"], category: "language" },
  { name: "C#", aliases: ["*C#", "csharp", "c sharp"], implies: ["Programming"], category: "language" },
  { name: "Go", aliases: ["*Go", "golang"], implies: ["Programming"], category: "language" },
  { name: "Rust", implies: ["Programming"], category: "language" },
  { name: "Ruby", implies: ["Programming"], category: "language" },
  { name: "PHP", aliases: ["php", "php8"], implies: ["Programming"], category: "language" },
  { name: "Swift", aliases: ["swift", "swift 5"], implies: ["Programming"], category: "language" },
  { name: "Objective-C", aliases: ["objective-c", "objc"], implies: ["C"], category: "language" },
  { name: "Dart", implies: ["Programming"], category: "language" },
  { name: "R", aliases: ["*R", "r language"], implies: ["Programming"], category: "language" },
  { name: "MATLAB", implies: ["Programming"], category: "language" },
  { name: "SQL", aliases: ["sql", "ansi sql"], implies: ["Relational Databases"], category: "database" },
  { name: "PL/SQL", aliases: ["pl/sql", "plsql"], implies: ["SQL"], category: "database" },
  { name: "T-SQL", aliases: ["t-sql", "tsql"], implies: ["SQL"], category: "database" },
  { name: "Shell", aliases: ["bash", "shell scripting", "zsh", "shell"], implies: ["Programming"], category: "language" },
  { name: "PowerShell", implies: ["Shell"], category: "language" },
  { name: "Perl", implies: ["Programming"], category: "language" },
  { name: "Haskell", implies: ["Programming"], category: "language" },
  { name: "Elixir", implies: ["Programming"], category: "language" },
  { name: "Erlang", implies: ["Programming"], category: "language" },
  { name: "Clojure", implies: ["Programming"], category: "language" },
  { name: "Lua", implies: ["Programming"], category: "language" },
  { name: "Solidity", implies: ["Programming"], category: "language" },

  // --- frontend -----------------------------------------------------------
  { name: "HTML", aliases: ["html", "html5"], implies: ["Frontend"], category: "frontend" },
  { name: "CSS", aliases: ["css", "css3"], implies: ["Frontend"], category: "frontend" },
  { name: "Sass", aliases: ["sass", "scss"], implies: ["CSS"], category: "frontend" },
  { name: "Tailwind", aliases: ["tailwind", "tailwindcss", "tailwind css"], implies: ["CSS"], category: "frontend" },
  { name: "Bootstrap", implies: ["CSS"], category: "frontend" },
  { name: "Material UI", aliases: ["material ui", "material-ui", "*MUI"], implies: ["React", "CSS"], category: "frontend" },
  { name: "React", aliases: ["react", "react.js", "reactjs", "react 18", "react 19"], implies: ["JavaScript", "Frontend"], category: "frontend" },
  { name: "Next.js", aliases: ["next.js", "nextjs", "next js"], implies: ["React", "Frontend"], category: "frontend" },
  { name: "Angular", aliases: ["angular", "angularjs"], implies: ["TypeScript", "Frontend"], category: "frontend" },
  { name: "Vue", aliases: ["vue", "vue.js", "vuejs", "nuxt"], implies: ["JavaScript", "Frontend"], category: "frontend" },
  { name: "Svelte", aliases: ["svelte", "sveltekit"], implies: ["JavaScript", "Frontend"], category: "frontend" },
  { name: "Remix", implies: ["React", "Frontend"], category: "frontend" },
  { name: "Astro", implies: ["Frontend"], category: "frontend" },
  { name: "Redux", aliases: ["redux", "redux toolkit"], implies: ["React"], category: "frontend" },
  { name: "React Query", aliases: ["react query", "tanstack query"], implies: ["React"], category: "frontend" },
  { name: "jQuery", implies: ["JavaScript"], category: "frontend" },
  { name: "Vite", aliases: ["vite", "vitejs"], implies: ["Frontend"], category: "frontend" },
  { name: "Webpack", implies: ["Frontend"], category: "frontend" },
  { name: "Babel", implies: ["JavaScript"], category: "frontend" },
  { name: "ESLint", implies: ["JavaScript"], category: "tooling" },
  { name: "Three.js", aliases: ["three.js", "threejs"], implies: ["JavaScript"], category: "frontend" },
  { name: "D3", aliases: ["d3.js", "*D3", "d3js"], implies: ["JavaScript"], category: "frontend" },
  { name: "GSAP", implies: ["JavaScript"], category: "frontend" },
  { name: "WebGL", implies: ["Frontend"], category: "frontend" },
  { name: "Progressive Web Apps", aliases: ["pwa", "progressive web app"], implies: ["Frontend"], category: "frontend" },
  { name: "SEO", aliases: ["*SEO", "search engine optimization"], category: "frontend" },
  { name: "Design Systems", aliases: ["design system", "design systems"], implies: ["UI/UX"], category: "design" },
  { name: "Figma", implies: ["UI/UX"], category: "design" },
  { name: "Wireframing", aliases: ["wireframe", "wireframing"], implies: ["UI/UX"], category: "design" },
  { name: "Prototyping", aliases: ["prototyping", "prototype"], implies: ["UI/UX"], category: "design" },
  { name: "User Research", aliases: ["user research", "usability testing"], implies: ["UI/UX"], category: "design" },

  // --- backend / runtimes -------------------------------------------------
  { name: "Node.js", aliases: ["node.js", "nodejs", "node js", "node"], implies: ["JavaScript", "Backend"], category: "backend" },
  { name: "Bun", aliases: ["bun runtime", "bun.js"], implies: ["JavaScript", "Backend"], category: "backend" },
  { name: "Deno", implies: ["JavaScript", "Backend"], category: "backend" },
  { name: "Express", aliases: ["express", "express.js", "expressjs"], implies: ["Node.js", "Backend"], category: "backend" },
  { name: "NestJS", aliases: ["nestjs", "nest.js"], implies: ["Node.js", "Backend"], category: "backend" },
  { name: "Fastify", implies: ["Node.js", "Backend"], category: "backend" },
  { name: "Django", aliases: ["django", "django rest framework"], implies: ["Python", "Backend"], category: "backend" },
  { name: "Flask", implies: ["Python", "Backend"], category: "backend" },
  { name: "FastAPI", aliases: ["fastapi", "fast api"], implies: ["Python", "Backend"], category: "backend" },
  { name: "Spring Boot", aliases: ["spring boot", "springboot", "spring framework", "spring"], implies: ["Java", "Backend"], category: "backend" },
  { name: "Ruby on Rails", aliases: ["ruby on rails", "rails"], implies: ["Ruby", "Backend"], category: "backend" },
  { name: "Laravel", implies: ["PHP", "Backend"], category: "backend" },
  { name: "ASP.NET", aliases: ["asp.net", "asp net", "aspnet"], implies: [".NET", "Backend"], category: "backend" },
  { name: ".NET", aliases: [".net", "dotnet", ".net core", ".net 6", ".net 8"], implies: ["C#", "Backend"], category: "backend" },
  { name: "gRPC", implies: ["REST APIs", "Microservices"], category: "backend" },
  { name: "Kafka", aliases: ["kafka", "apache kafka"], implies: ["Streaming", "Message Queues"], category: "data" },
  { name: "RabbitMQ", implies: ["Message Queues"], category: "backend" },
  { name: "NATS", implies: ["Message Queues"], category: "backend" },
  { name: "Celery", implies: ["Python", "Message Queues"], category: "backend" },
  { name: "OAuth", aliases: ["oauth", "oauth2", "oauth 2.0"], implies: ["Security"], category: "security" },
  { name: "JWT", aliases: ["*JWT", "json web token"], implies: ["Security"], category: "security" },
  { name: "SAML", aliases: ["saml", "sso"], implies: ["Security"], category: "security" },
  { name: "Keycloak", implies: ["Security"], category: "security" },
  { name: "Payment Integration", aliases: ["stripe", "razorpay", "payment gateway", "payments"], implies: ["Backend"], category: "backend" },
  { name: "Web Scraping", aliases: ["web scraping", "scraping", "puppeteer", "beautifulsoup"], implies: ["Backend"], category: "backend" },

  // --- mobile -------------------------------------------------------------
  { name: "iOS", aliases: ["ios", "ios development"], implies: ["Mobile"], category: "mobile" },
  { name: "Android", aliases: ["android", "android development"], implies: ["Mobile"], category: "mobile" },
  { name: "React Native", aliases: ["react native", "react-native"], implies: ["React", "Mobile"], category: "mobile" },
  { name: "Flutter", aliases: ["flutter", "dart flutter"], implies: ["Dart", "Mobile"], category: "mobile" },
  { name: "SwiftUI", implies: ["Swift", "iOS"], category: "mobile" },
  { name: "UIKit", implies: ["Swift", "iOS"], category: "mobile" },
  { name: "Jetpack Compose", aliases: ["jetpack compose", "compose"], implies: ["Kotlin", "Android"], category: "mobile" },
  { name: "Xcode", implies: ["iOS"], category: "tooling" },
  { name: "Android Studio", implies: ["Android"], category: "tooling" },
  { name: "Gradle", implies: ["Android"], category: "tooling" },
  { name: "Expo", implies: ["React Native"], category: "mobile" },
  { name: "Firebase", aliases: ["firebase", "firestore"], implies: ["Cloud", "NoSQL"], category: "cloud" },

  // --- databases ----------------------------------------------------------
  { name: "PostgreSQL", aliases: ["postgresql", "postgres", "psql", "pg"], implies: ["Relational Databases", "SQL"], category: "database" },
  { name: "MySQL", implies: ["Relational Databases", "SQL"], category: "database" },
  { name: "MariaDB", implies: ["MySQL"], category: "database" },
  { name: "SQL Server", aliases: ["sql server", "mssql", "microsoft sql server"], implies: ["Relational Databases", "SQL"], category: "database" },
  { name: "Oracle DB", aliases: ["oracle db", "oracle database", "oracle sql"], implies: ["Relational Databases", "SQL"], category: "database" },
  { name: "SQLite", implies: ["Relational Databases", "SQL"], category: "database" },
  { name: "MongoDB", aliases: ["mongodb", "mongo", "mongoose"], implies: ["NoSQL"], category: "database" },
  { name: "DynamoDB", aliases: ["dynamodb", "dynamo db"], implies: ["NoSQL", "AWS"], category: "database" },
  { name: "Cassandra", implies: ["NoSQL"], category: "database" },
  { name: "Redis", implies: ["NoSQL", "Caching"], category: "database" },
  { name: "Memcached", implies: ["Caching"], category: "database" },
  { name: "Elasticsearch", aliases: ["elasticsearch", "elastic search", "opensearch", "elk stack", "elk"], implies: ["Search Engines", "NoSQL"], category: "database" },
  { name: "Neo4j", aliases: ["neo4j", "graph database"], implies: ["NoSQL"], category: "database" },
  { name: "Snowflake", implies: ["Data Warehouse", "SQL"], category: "data" },
  { name: "BigQuery", aliases: ["bigquery", "big query"], implies: ["Data Warehouse", "SQL", "GCP"], category: "data" },
  { name: "Redshift", aliases: ["redshift", "amazon redshift"], implies: ["Data Warehouse", "SQL", "AWS"], category: "data" },
  { name: "Databricks", implies: ["Big Data", "Data Warehouse"], category: "data" },
  { name: "Prisma", implies: ["Relational Databases", "TypeScript"], category: "database" },
  { name: "TypeORM", implies: ["Relational Databases", "TypeScript"], category: "database" },
  { name: "Sequelize", implies: ["Relational Databases", "Node.js"], category: "database" },
  { name: "Hibernate", aliases: ["hibernate", "jpa"], implies: ["Java", "Relational Databases"], category: "database" },
  { name: "Supabase", implies: ["PostgreSQL", "Cloud"], category: "database" },

  // --- cloud: AWS ---------------------------------------------------------
  { name: "AWS", aliases: ["aws", "amazon web services"], implies: ["Cloud"], category: "cloud" },
  { name: "EC2", aliases: ["ec2", "elastic compute cloud"], implies: ["AWS"], category: "cloud" },
  { name: "S3", aliases: ["*S3", "amazon s3", "s3 bucket", "simple storage service"], implies: ["AWS"], category: "cloud" },
  { name: "Lambda", aliases: ["lambda", "aws lambda"], implies: ["AWS", "Serverless"], category: "cloud" },
  { name: "ECS", aliases: ["ecs", "elastic container service"], implies: ["AWS", "Containers"], category: "cloud" },
  { name: "EKS", aliases: ["eks", "elastic kubernetes service"], implies: ["AWS", "Kubernetes", "Containers"], category: "cloud" },
  { name: "Fargate", implies: ["ECS", "AWS"], category: "cloud" },
  { name: "RDS", aliases: ["rds", "aurora", "amazon aurora"], implies: ["AWS", "Relational Databases"], category: "cloud" },
  { name: "SQS", implies: ["AWS", "Message Queues"], category: "cloud" },
  { name: "SNS", implies: ["AWS", "Message Queues"], category: "cloud" },
  { name: "EventBridge", implies: ["AWS"], category: "cloud" },
  { name: "Step Functions", aliases: ["step functions", "aws step functions"], implies: ["AWS"], category: "cloud" },
  { name: "API Gateway", aliases: ["api gateway", "apigateway"], implies: ["AWS", "REST APIs"], category: "cloud" },
  { name: "CloudFront", aliases: ["cloudfront", "cdn"], implies: ["AWS"], category: "cloud" },
  { name: "Route 53", aliases: ["route 53", "route53", "amazon route 53"], implies: ["AWS", "DNS"], category: "cloud" },
  { name: "IAM", aliases: ["*IAM"], implies: ["AWS", "Security"], category: "security" },
  { name: "CloudWatch", implies: ["AWS", "Observability"], category: "cloud" },
  { name: "CloudFormation", aliases: ["cloudformation", "cloud formation", "aws cdk", "cdk"], implies: ["AWS", "Infrastructure as Code"], category: "cloud" },
  { name: "CodePipeline", aliases: ["codepipeline", "codebuild", "codecommit", "aws codepipeline"], implies: ["AWS", "CI/CD"], category: "cloud" },
  { name: "Glue", aliases: ["aws glue", "glue etl"], implies: ["AWS", "ETL", "Data Engineering"], category: "data" },
  { name: "Athena", aliases: ["aws athena", "athena query"], implies: ["AWS", "SQL", "Big Data"], category: "data" },
  { name: "Kinesis", aliases: ["kinesis", "kinesis firehose"], implies: ["AWS", "Streaming"], category: "data" },
  { name: "EMR", aliases: ["*EMR", "emr cluster"], implies: ["AWS", "Big Data", "Spark"], category: "data" },
  { name: "SageMaker", aliases: ["sagemaker", "sagemaker studio"], implies: ["AWS", "Machine Learning"], category: "ml" },
  { name: "Cognito", implies: ["AWS", "Security"], category: "security" },
  { name: "Secrets Manager", aliases: ["secrets manager", "aws secrets manager", "parameter store"], implies: ["AWS", "Security"], category: "security" },
  { name: "ElastiCache", implies: ["AWS", "Caching"], category: "cloud" },
  { name: "EBS", aliases: ["*EBS", "ebs volume"], implies: ["AWS"], category: "cloud" },
  { name: "Amplify", implies: ["AWS", "Frontend"], category: "cloud" },

  // --- cloud: GCP / Azure -------------------------------------------------
  { name: "GCP", aliases: ["gcp", "google cloud", "google cloud platform"], implies: ["Cloud"], category: "cloud" },
  { name: "GKE", aliases: ["gke", "google kubernetes engine"], implies: ["GCP", "Kubernetes"], category: "cloud" },
  { name: "Cloud Run", aliases: ["cloud run", "google cloud run"], implies: ["GCP", "Serverless", "Containers"], category: "cloud" },
  { name: "Cloud Functions", aliases: ["cloud functions", "google cloud functions"], implies: ["GCP", "Serverless"], category: "cloud" },
  { name: "Pub/Sub", aliases: ["pub/sub", "pubsub", "google pubsub"], implies: ["GCP", "Message Queues"], category: "cloud" },
  { name: "Dataflow", aliases: ["dataflow", "apache beam"], implies: ["GCP", "Big Data"], category: "data" },
  { name: "Dataproc", implies: ["GCP", "Big Data", "Spark"], category: "data" },
  { name: "Vertex AI", aliases: ["vertex ai", "vertex"], implies: ["GCP", "Machine Learning"], category: "ml" },
  { name: "Spanner", aliases: ["bigtable", "spanner"], implies: ["GCP", "NoSQL"], category: "database" },
  { name: "Azure", aliases: ["azure", "microsoft azure"], implies: ["Cloud"], category: "cloud" },
  { name: "AKS", aliases: ["aks", "azure kubernetes service"], implies: ["Azure", "Kubernetes"], category: "cloud" },
  { name: "Azure Functions", aliases: ["azure functions", "azure function app"], implies: ["Azure", "Serverless"], category: "cloud" },
  { name: "Azure DevOps", aliases: ["azure devops", "azure pipelines"], implies: ["Azure", "CI/CD"], category: "cloud" },
  { name: "Cosmos DB", aliases: ["cosmos db", "cosmosdb"], implies: ["Azure", "NoSQL"], category: "database" },
  { name: "Blob Storage", aliases: ["blob storage", "azure blob"], implies: ["Azure"], category: "cloud" },
  { name: "Synapse", aliases: ["synapse", "azure synapse"], implies: ["Azure", "Data Warehouse"], category: "data" },
  { name: "Data Factory", aliases: ["data factory", "azure data factory"], implies: ["Azure", "ETL"], category: "data" },
  { name: "Entra ID", aliases: ["entra id", "azure ad", "active directory"], implies: ["Azure", "Security"], category: "security" },
  { name: "Serverless", aliases: ["serverless"], implies: ["Cloud"], category: "cloud" },

  // --- devops / infra -----------------------------------------------------
  { name: "Docker", aliases: ["docker", "dockerfile", "docker compose"], implies: ["Containers"], category: "devops" },
  { name: "Kubernetes", aliases: ["kubernetes", "*K8s", "kube"], implies: ["Containers", "Orchestration"], category: "devops" },
  { name: "Helm", aliases: ["helm", "helm charts"], implies: ["Kubernetes"], category: "devops" },
  { name: "ArgoCD", aliases: ["argocd", "argo cd", "argo workflows"], implies: ["Kubernetes", "CI/CD"], category: "devops" },
  { name: "Istio", aliases: ["istio", "service mesh"], implies: ["Kubernetes", "Networking"], category: "devops" },
  { name: "Terraform", aliases: ["terraform", "tf modules"], implies: ["Infrastructure as Code"], category: "devops" },
  { name: "Pulumi", implies: ["Infrastructure as Code"], category: "devops" },
  { name: "Ansible", aliases: ["ansible", "ansible playbook"], implies: ["Infrastructure as Code"], category: "devops" },
  { name: "Jenkins", implies: ["CI/CD"], category: "devops" },
  { name: "GitHub Actions", aliases: ["github actions", "gh actions"], implies: ["CI/CD"], category: "devops" },
  { name: "GitLab CI", aliases: ["gitlab ci", "gitlab pipelines"], implies: ["CI/CD"], category: "devops" },
  { name: "CircleCI", implies: ["CI/CD"], category: "devops" },
  { name: "Nginx", aliases: ["nginx", "reverse proxy"], implies: ["Networking"], category: "devops" },
  { name: "Linux", aliases: ["linux", "ubuntu", "debian", "rhel", "centos"], category: "devops" },
  { name: "Unix", implies: ["Linux"], category: "devops" },
  { name: "Networking", aliases: ["tcp/ip", "*TCP", "http/2", "http", "dns", "*DNS"], category: "devops" },
  { name: "Prometheus", aliases: ["prometheus", "promql"], implies: ["Observability"], category: "devops" },
  { name: "Grafana", implies: ["Observability"], category: "devops" },
  { name: "Datadog", implies: ["Observability"], category: "devops" },
  { name: "Splunk", implies: ["Observability"], category: "devops" },
  { name: "OpenTelemetry", aliases: ["opentelemetry", "otel", "jaeger"], implies: ["Observability"], category: "devops" },
  { name: "New Relic", aliases: ["new relic", "newrelic"], implies: ["Observability"], category: "devops" },
  { name: "Load Balancing", aliases: ["load balancing", "load balancer", "elb", "alb"], implies: ["Networking"], category: "devops" },
  { name: "Scripting", aliases: ["scripting", "automation scripting"], implies: ["Programming"], category: "devops" },
  { name: "Vagrant", implies: ["DevOps"], category: "devops" },
  { name: "Vercel", implies: ["Cloud", "Frontend"], category: "cloud" },
  { name: "Cloudflare", aliases: ["cloudflare", "cloudflare workers"], implies: ["Cloud"], category: "cloud" },
  { name: "Heroku", implies: ["Cloud"], category: "cloud" },
  { name: "DigitalOcean", aliases: ["digitalocean", "digital ocean"], implies: ["Cloud"], category: "cloud" },

  // --- data / analytics ---------------------------------------------------
  { name: "Pandas", aliases: ["pandas"], implies: ["Python", "Analytics"], category: "data" },
  { name: "NumPy", aliases: ["numpy"], implies: ["Python", "Analytics"], category: "data" },
  { name: "Polars", implies: ["Python", "Analytics"], category: "data" },
  { name: "Spark", aliases: ["spark", "apache spark", "pyspark"], implies: ["Big Data"], category: "data" },
  { name: "Hadoop", aliases: ["hadoop", "hdfs", "hive"], implies: ["Big Data"], category: "data" },
  { name: "Airflow", aliases: ["airflow", "apache airflow", "dagster", "prefect"], implies: ["Data Engineering", "Orchestration"], category: "data" },
  { name: "dbt", aliases: ["dbt", "data build tool"], implies: ["ETL", "SQL", "Data Warehouse"], category: "data" },
  { name: "ETL", aliases: ["*ETL", "elt", "data pipelines", "data pipeline"], implies: ["Data Engineering"], category: "data" },
  { name: "Data Modeling", aliases: ["data modeling", "data modelling", "dimensional modeling"], implies: ["Data Engineering", "Databases"], category: "data" },
  { name: "Tableau", implies: ["Business Intelligence"], category: "data" },
  { name: "Power BI", aliases: ["power bi", "powerbi"], implies: ["Business Intelligence"], category: "data" },
  { name: "Looker", aliases: ["looker", "looker studio"], implies: ["Business Intelligence"], category: "data" },
  { name: "Excel", aliases: ["excel", "ms excel", "microsoft excel", "spreadsheets"], category: "data" },
  { name: "Jupyter", aliases: ["jupyter", "jupyter notebook"], implies: ["Python"], category: "data" },
  { name: "Statistics", aliases: ["statistics", "statistical analysis", "hypothesis testing"], implies: ["Analytics"], category: "data" },
  { name: "A/B Testing", aliases: ["a/b testing", "ab testing", "experimentation"], implies: ["Analytics"], category: "data" },
  { name: "Data Visualization", aliases: ["data visualization", "data visualisation", "matplotlib", "seaborn", "plotly"], implies: ["Analytics"], category: "data" },
  { name: "Data Governance", aliases: ["data governance", "data quality", "data catalog"], implies: ["Data Engineering"], category: "data" },
  { name: "S3 Data Lake", aliases: ["data lake", "data lakehouse", "delta lake", "iceberg"], implies: ["Data Engineering", "Big Data"], category: "data" },

  // --- ml -----------------------------------------------------------------
  { name: "scikit-learn", aliases: ["scikit-learn", "sklearn"], implies: ["Python", "Machine Learning"], category: "ml" },
  { name: "TensorFlow", aliases: ["tensorflow", "keras"], implies: ["Deep Learning", "Python"], category: "ml" },
  { name: "PyTorch", aliases: ["pytorch", "torch", "lightning"], implies: ["Deep Learning", "Python"], category: "ml" },
  { name: "Hugging Face", aliases: ["hugging face", "huggingface", "transformers library"], implies: ["Natural Language Processing", "Generative AI"], category: "ml" },
  { name: "LangChain", aliases: ["langchain", "llamaindex", "langgraph"], implies: ["Generative AI", "Python"], category: "ml" },
  { name: "RAG", aliases: ["*RAG", "retrieval augmented generation", "vector database", "pinecone", "weaviate", "qdrant", "pgvector"], implies: ["Generative AI"], category: "ml" },
  { name: "LLM", aliases: ["*LLM", "llms", "large language model", "large language models", "gpt", "openai api", "claude api", "prompt engineering"], implies: ["Generative AI"], category: "ml" },
  { name: "Fine-tuning", aliases: ["fine-tuning", "finetuning", "lora", "peft"], implies: ["Deep Learning"], category: "ml" },
  { name: "Model Deployment", aliases: ["model deployment", "model serving", "vllm", "triton", "onnx"], implies: ["MLOps", "Machine Learning"], category: "ml" },
  { name: "Feature Engineering", aliases: ["feature engineering", "feature store"], implies: ["Machine Learning"], category: "ml" },
  { name: "Recommendation Systems", aliases: ["recommendation system", "recommender", "recsys"], implies: ["Machine Learning"], category: "ml" },
  { name: "Time Series", aliases: ["time series", "forecasting"], implies: ["Machine Learning", "Statistics"], category: "ml" },
  { name: "OpenCV", implies: ["Computer Vision", "Python"], category: "ml" },

  // --- testing ------------------------------------------------------------
  { name: "Jest", implies: ["JavaScript", "Testing"], category: "testing" },
  { name: "Vitest", implies: ["JavaScript", "Testing"], category: "testing" },
  { name: "Mocha", aliases: ["mocha", "chai"], implies: ["JavaScript", "Testing"], category: "testing" },
  { name: "Playwright", aliases: ["playwright"], implies: ["Test Automation"], category: "testing" },
  { name: "Cypress", implies: ["Test Automation", "Frontend"], category: "testing" },
  { name: "Selenium", implies: ["Test Automation"], category: "testing" },
  { name: "Appium", implies: ["Test Automation", "Mobile"], category: "testing" },
  { name: "Pytest", aliases: ["pytest", "unittest"], implies: ["Python", "Testing"], category: "testing" },
  { name: "JUnit", aliases: ["junit", "testng", "mockito"], implies: ["Java", "Testing"], category: "testing" },
  { name: "Postman", implies: ["Testing", "REST APIs"], category: "testing" },
  { name: "JMeter", aliases: ["jmeter", "k6", "gatling"], implies: ["Performance Testing"], category: "testing" },
  { name: "TDD", aliases: ["*TDD", "test-driven development", "test driven"], implies: ["Testing"], category: "testing" },
  { name: "Unit Testing", aliases: ["unit testing", "unit tests"], implies: ["Testing"], category: "testing" },
  { name: "Integration Testing", aliases: ["integration testing", "integration tests", "end-to-end testing", "e2e testing"], implies: ["Testing"], category: "testing" },
  { name: "Code Review", aliases: ["code review", "code reviews", "peer review"], implies: ["Testing"], category: "practice" },

  // --- security -----------------------------------------------------------
  { name: "Penetration Testing", aliases: ["penetration testing", "pentest", "burp suite", "owasp"], implies: ["Security"], category: "security" },
  { name: "Encryption", aliases: ["encryption", "tls", "cryptography"], implies: ["Security"], category: "security" },
  { name: "Compliance", aliases: ["gdpr", "soc 2", "hipaa", "pci dss", "compliance"], implies: ["Security"], category: "security" },

  // --- tooling / process --------------------------------------------------
  { name: "Git", aliases: ["git", "version control"], category: "tooling" },
  { name: "GitHub", aliases: ["github", "gh cli"], implies: ["Git"], category: "tooling" },
  { name: "GitLab", implies: ["Git"], category: "tooling" },
  { name: "Bitbucket", implies: ["Git"], category: "tooling" },
  { name: "Jira", aliases: ["jira", "atlassian"], category: "tooling" },
  { name: "Confluence", implies: ["Jira"], category: "tooling" },
  { name: "Notion", category: "tooling" },
  { name: "Slack", category: "tooling" },
  { name: "VS Code", aliases: ["vs code", "vscode", "visual studio code"], category: "tooling" },
  { name: "IntelliJ", aliases: ["intellij", "pycharm", "webstorm"], category: "tooling" },
  { name: "Vim", aliases: ["vim", "neovim"], category: "tooling" },
  { name: "Swagger", aliases: ["swagger", "openapi", "open api"], implies: ["REST APIs"], category: "tooling" },
  { name: "npm", aliases: ["npm", "yarn", "pnpm"], implies: ["Node.js"], category: "tooling" },
  { name: "Maven", aliases: ["maven", "gradle build", "ant build"], implies: ["Java"], category: "tooling" },
  { name: "Stakeholder Management", aliases: ["stakeholder management", "stakeholders", "cross-functional"], category: "product" },
  { name: "Mentoring", aliases: ["mentoring", "mentorship", "mentored", "coaching", "onboarding engineers"], category: "practice" },
  { name: "Technical Writing", aliases: ["technical writing", "documentation", "rfc"], category: "practice" },
  { name: "Copywriting", aliases: ["copywriting", "content writing", "seo content"], category: "design" },
  { name: "Salesforce", aliases: ["salesforce", "apex"], category: "product" },
  { name: "SAP", aliases: ["*SAP", "sap erp"], category: "product" },
  { name: "ServiceNow", aliases: ["servicenow", "itsm"], category: "product" },
  { name: "Customer Support", aliases: ["customer support", "customer service", "help desk", "ticketing", "support tickets", "technical support", "support analyst"], category: "product" },
  { name: "Zendesk", aliases: ["zendesk"], implies: ["Customer Support"], category: "product" },
  { name: "Ticket Triage", aliases: ["ticket triage", "triage", "ticket routing"], implies: ["Customer Support"], category: "product" },
  { name: "Knowledge Base", aliases: ["knowledge base", "kb articles", "help center", "documentation articles"], implies: ["Customer Support"], category: "product" },
  { name: "SLA Management", aliases: ["sla management", "sla", "service level agreements", "slas"], implies: ["Customer Support"], category: "product" },
  { name: "Customer Communication", aliases: ["customer communication", "written communication", "email support", "client communication"], implies: ["Customer Support"], category: "practice" },
  { name: "Digital Marketing", aliases: ["digital marketing", "campaigns", "marketing campaigns"], category: "product" },
  { name: "Google Analytics", aliases: ["google analytics", "ga4"], implies: ["Digital Marketing"], category: "product" },
  { name: "Google Ads", aliases: ["google ads", "adwords", "ppc", "paid search"], implies: ["Digital Marketing"], category: "product" },
  { name: "HubSpot", aliases: ["hubspot", "crm"], implies: ["Digital Marketing"], category: "product" },
  { name: "Email Marketing", aliases: ["email marketing", "mailchimp", "klaviyo", "drip campaign", "newsletter"], implies: ["Digital Marketing"], category: "product" },
  { name: "Content Strategy", aliases: ["content strategy", "content marketing", "content planning", "editorial calendar"], implies: ["Digital Marketing"], category: "product" },
  { name: "Mixpanel", aliases: ["mixpanel"], implies: ["Analytics"], category: "data" },
  { name: "Amplitude", aliases: ["amplitude", "product analytics"], implies: ["Analytics"], category: "data" },
  { name: "Roadmapping", aliases: ["roadmapping", "roadmap", "product roadmap", "backlog grooming"], implies: ["Product Management"], category: "product" },
  { name: "Requirements Gathering", aliases: ["requirements gathering", "requirements elicitation", "user stories", "business requirements", "brd"], implies: ["Product Management"], category: "product" },
  { name: "Process Mapping", aliases: ["process mapping", "process modelling", "process modeling", "bpmn", "as-is process"], category: "practice" },
  { name: "XGBoost", aliases: ["xgboost", "gradient boosting", "lightgbm", "catboost"], implies: ["Machine Learning", "scikit-learn"], category: "ml" },
  { name: "Interaction Design", aliases: ["interaction design", "interaction designer"], implies: ["UI/UX"], category: "design" },
  { name: "Usability Testing", aliases: ["usability testing", "usability test", "usability studies"], implies: ["UI/UX"], category: "design" },
  { name: "Combine", aliases: ["combine framework", "combine publishers"], implies: ["iOS", "Swift"], category: "mobile" },
  { name: "Core Data", aliases: ["core data", "coredata", "realm", "swiftdata"], implies: ["iOS"], category: "mobile" },
  { name: "XCTest", aliases: ["xctest", "xctestcase", "quick/nimble"], implies: ["iOS", "Test Automation"], category: "testing" },
  { name: "Fastlane", aliases: ["fastlane"], implies: ["iOS", "CI/CD"], category: "mobile" },
  { name: "API Testing", aliases: ["api testing", "api tests", "contract testing"], implies: ["Testing"], category: "testing" },
]

export interface ResolvedSkill {
  canonical: string
  aliases: string[]
  category?: SkillCategory
  /** Umbrella skill: never emitted as a candidate's own skill. */
  abstract: boolean
  /** All broader skills this implies, transitively (excluding itself). */
  ancestors: string[]
  /** All narrower skills that imply this one, transitively. */
  descendants: string[]
}

const byName = new Map<string, ResolvedSkill>()
const aliasIndex = new Map<string, string>() // normalized alias -> canonical
const caseSensitiveAliases = new Set<string>()

function aliasKey(alias: string): string {
  return alias.startsWith("*") ? alias.slice(1) : alias.toLowerCase()
}

function addSkill(def: SkillDef): ResolvedSkill {
  const entry = byName.get(def.name)
  if (entry) return entry
  const fresh: ResolvedSkill = {
    canonical: def.name,
    aliases: [def.name.toLowerCase(), ...(def.aliases ?? []).map(aliasKey)],
    category: def.category,
    abstract: def.abstract === true,
    ancestors: [],
    descendants: [],
  }
  byName.set(def.name, fresh)
  return fresh
}

// Pass 1: register every canonical name and alias.
for (const def of SKILLS) {
  const entry = addSkill(def)
  for (const raw of [def.name, ...(def.aliases ?? [])]) {
    const key = aliasKey(raw)
    if (raw.startsWith("*")) caseSensitiveAliases.add(key)
    // First registration wins so a more specific skill cannot be shadowed by a
    // later generic alias (e.g. "node" registered to Node.js).
    if (!aliasIndex.has(key)) aliasIndex.set(key, def.name)
    if (!aliasIndex.has(key.toLowerCase()) && key !== key.toLowerCase()) {
      aliasIndex.set(key.toLowerCase(), def.name)
    }
  }
  if (!entry.aliases.includes(def.name.toLowerCase())) entry.aliases.push(def.name.toLowerCase())
}

// Pass 2: build the implication DAG (skill -> parents).
const impliesEdges = new Map<string, string[]>()
for (const def of SKILLS) {
  if (def.implies?.length) impliesEdges.set(def.name, def.implies)
}

function ancestorsOf(name: string, seen = new Set<string>()): string[] {
  const out: string[] = []
  for (const parent of impliesEdges.get(name) ?? []) {
    if (seen.has(parent)) continue
    seen.add(parent)
    out.push(parent)
    out.push(...ancestorsOf(parent, seen))
  }
  return out
}

for (const def of SKILLS) {
  const entry = byName.get(def.name)!!
  entry.ancestors = [...new Set(ancestorsOf(def.name))]
}

// Reverse edges: descendants (transitively narrower skills).
for (const entry of byName.values()) {
  for (const ancestor of entry.ancestors) {
    const parent = byName.get(ancestor)
    if (parent && !parent.descendants.includes(entry.canonical)) {
      parent.descendants.push(entry.canonical)
    }
  }
}

export function knownSkills(): string[] {
  return [...byName.keys()]
}

/**
 * Umbrellas that own concrete services, i.e. the platform side of a
 * platform<->service family: a candidate who knows AWS plausibly works with S3,
 * one who knows Kubernetes with EKS. Only these may grant downward (generic ->
 * specific) credit.
 *
 * Standards and concepts are deliberately absent: knowing SQL does not mean
 * knowing PostgreSQL, "Containers" does not mean Docker, and "Cloud" does not
 * mean AWS. Those requirements credit only when the specific product is named
 * (or when the typed layer confirms it).
 */
export const PLATFORM_UMBRELLAS = new Set([
  "AWS",
  "Google Cloud",
  "Microsoft Azure",
  "Kubernetes",
  "Docker",
  "Salesforce",
  "Snowflake",
  "Databricks",
  "Cloudflare",
  "Terraform",
  "Hadoop",
  "Spark",
  "Elasticsearch",
  "Datadog",
  "GitHub Actions",
  "Jenkins",
  "Firebase",
  "Supabase",
  "Vercel",
  "Shopify",
  "WordPress",
  "SAP",
  "Salesforce Platform",
])

export function isPlatformUmbrella(canonical: string): boolean {
  return PLATFORM_UMBRELLAS.has(canonical)
}

export function skillInfo(canonical: string): ResolvedSkill | undefined {
  return byName.get(canonical)
}

export function isKnownSkill(canonical: string): boolean {
  return byName.has(canonical)
}

/** Umbrella skills are matching targets only — never emitted for a candidate. */
export function isAbstractSkill(canonical: string): boolean {
  return byName.get(canonical)?.abstract === true
}

export function ancestorsOfSkill(canonical: string): string[] {
  return byName.get(canonical)?.ancestors ?? []
}

export function descendantsOfSkill(canonical: string): string[] {
  return byName.get(canonical)?.descendants ?? []
}

/** Map a free-text skill label to a canonical name, or null if unknown. */
export function canonicalize(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^[•\-*\s]+/, "")
    .replace(/[.;,]+$/, "")
    .trim()
  if (!cleaned) return null
  const direct = aliasIndex.get(cleaned) ?? aliasIndex.get(cleaned.toLowerCase())
  if (direct) return direct
  // Try the longest alias contained in the label ("React.js (hooks)" -> React).
  const lower = ` ${cleaned.toLowerCase()} `
  let best: { canonical: string; len: number } | null = null
  for (const [alias, canonical] of aliasIndex) {
    if (alias.length < 3) continue
    if (lower.includes(` ${alias} `) || lower.includes(`${alias},`) || lower.includes(`(${alias})`)) {
      if (!best || alias.length > best.len) best = { canonical, len: alias.length }
    }
  }
  return best?.canonical ?? null
}

/** All canonical skills mentioned in a block of text. */
export function canonicalSet(labels: Array<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const label of labels) {
    if (!label) continue
    const c = canonicalize(label)
    if (c) out.add(c)
  }
  return [...out]
}

export function isCaseSensitiveAlias(alias: string): boolean {
  return caseSensitiveAliases.has(alias)
}

export const ONTOLOGY = {
  skills: byName,
  aliasIndex,
  caseSensitiveAliases,
  /** The raw definitions (used to tell declared aliases from canonical names). */
  definitions: SKILLS,
}
