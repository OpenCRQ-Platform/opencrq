# Deployment Documentation

This folder contains all documentation related to deploying and configuring OpenCRQ.

## Index

- [**Architecture**](architecture.md)  
  Technical overview of the architecture.

- [**Configuration**](configuration.md)  
  Reference for environment variables and configuration settings.

- [**Metrics**](metrics.md)  
  Contract for every metric OpenCRQ exposes, plus a scrape recipe and OpenCTI-compatible recording rules.

- [**Asset Consolidation**](asset-consolidation.md)  
  How several connectors reporting one machine become one asset, which value wins, and what a hand edit survives.

- [**Dependency Rules**](dependency-rules.md)  
  How rules link supporting assets to primary assets, what a person's link or removal wins over, and when rules re-apply.

- [**OpenCTI Connector**](opencti-connector.md)  
  Live Stream filter, token access requirements and tenant connection steps for the OpenCTI connector.

- [**OpenAEV Connector**](openaev-connector.md)  
  What the OpenAEV connector syncs, what the OpenAEV side must provide, how often each phase runs and when what it reported goes stale.

- [**Anonymous Usage Telemetry**](usage-telemetry.md)  
  What anonymous usage statistics are collected and how to tag deployments.
