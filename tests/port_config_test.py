import importlib.util
import pathlib
import unittest
spec=importlib.util.spec_from_file_location('port_config',pathlib.Path(__file__).resolve().parents[1]/'deploy/alternate-port.py')
config=importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

class PortConfigTest(unittest.TestCase):
    def test_certbot_ipv4_ipv6_and_redirect(self):
        original='''server {\nserver_name tokenapp.ru;\nlisten 443 ssl;\nlisten [::]:443 ssl ipv6only=on;\nssl_certificate /etc/letsencrypt/live/tokenapp.ru/fullchain.pem;\n}\nserver {\nlisten 80;\nreturn 301 https://$host$request_uri;\n}'''
        actual=config.transform_nginx(original)
        self.assertIn('listen 8443 ssl;',actual)
        self.assertIn('listen [::]:8443 ssl ipv6only=on;',actual)
        self.assertIn('listen 80;',actual)
        self.assertIn('https://$host:8443$request_uri',actual)
        self.assertIn('/etc/letsencrypt/live/tokenapp.ru/fullchain.pem',actual)
        self.assertEqual(config.transform_nginx(actual),actual)
    def test_env_preserves_credentials_and_other_settings(self):
        original='GOOGLE_API_KEY=test-google\nOPENROUTER_API_KEY=test-router\nPORT=3000\nPUBLIC_ORIGIN=https://tokenapp.ru\n'
        actual=config.transform_env(original)
        self.assertIn('OPENROUTER_API_KEY=test-router\n',actual)
        self.assertIn('GOOGLE_API_KEY=test-google\n',actual)
        self.assertIn('PORT=3000\n',actual)
        self.assertEqual(actual.count('PUBLIC_ORIGIN='),1)
        self.assertIn('PUBLIC_ORIGIN=https://tokenapp.ru:8443\n',actual)
    def test_unrelated_nginx_host_is_rejected(self):
        with self.assertRaises(ValueError):
            config.transform_nginx('server { listen 443 ssl; server_name other.example; }')

if __name__=='__main__':
    unittest.main()
